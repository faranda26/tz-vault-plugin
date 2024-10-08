/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Config } from '@backstage/config';
import { InputError } from '@backstage/errors';
import {
  LoggerService,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
  SchedulerService,
  SchedulerServiceTaskRunner,
  SchedulerServiceTaskScheduleDefinition,
  SchedulerServiceTaskScheduleDefinitionConfig,
} from '@backstage/backend-plugin-api';
import express from 'express';
import Router from 'express-promise-router';
import { VaultApi, VaultClient } from './vaultApi';
import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';

/**
 * Environment values needed by the VaultBuilder
 * @public
 */
export interface VaultEnvironment {
  logger: LoggerService;
  config: Config;
  scheduler: SchedulerService;
}

/**
 * The object returned by the VaultBuilder.build() function
 * @public
 */
export type VaultBuilderReturn = {
  router: express.Router;
};

/**
 * Implementation for Vault. It creates the routing and initializes the backend
 * to allow the use of the Vault's frontend plugin.
 * @public
 */
export class VaultBuilder {
  private vaultApi?: VaultApi;

  /**
   * Creates a new instance of the VaultBuilder.
   *
   * @param env - The backstage environment
   * @returns A new instance of the VaultBuilder
   */
  static createBuilder(env: VaultEnvironment) {
    return new VaultBuilder(env);
  }

  constructor(private readonly env: VaultEnvironment) {}

  /**
   * Builds the routes for Vault.
   *
   * @returns The router configured for Vault
   */
  public build(): VaultBuilderReturn {
    const { logger, config } = this.env;

    logger.info('Initializing Vault backend');

    if (!config.has('vault')) {
      logger.warn(
        'Failed to initialize Vault backend: vault config is missing',
      );
      return {
        router: Router(),
      };
    }

    if (config.has('vault.token')) {
      logger.warn(
        "The 'vault.token' configuration has been deprecated, use 'vault.auth' instead",
      );
    }

    this.vaultApi = this.vaultApi ?? new VaultClient(this.env);

    const router = this.buildRouter(this.vaultApi);

    return {
      router: router,
    };
  }

  /**
   * Overwrites the current vault client.
   *
   * @param vaultApi - The new Vault client
   * @returns
   */
  public setVaultClient(vaultApi: VaultApi) {
    this.vaultApi = vaultApi;
    return this;
  }

  /**
   * Enables the token renewal for Vault. The schedule if configured in the app-config.yaml file.
   * If not set, the renewal is executed hourly.
   *
   * The token renewal is only needed for the static secret authentication.
   *
   * @returns
   */
  public async enableTokenRenew(schedule?: SchedulerServiceTaskRunner) {
    if (
      this.env.config.has('vault.auth') && // FIXME: Needed to allow retro-compatibility to work. Remove in future release
      this.env.config.getString('vault.auth.type') === 'kubernetes'
    ) {
      this.env.logger.warn(
        'Token renewal not supported for Kubernetes authentication',
      );
      return this;
    }

    const taskRunner = schedule
      ? schedule
      : this.env.scheduler.createScheduledTaskRunner(this.getConfigSchedule());

    await taskRunner.run({
      id: 'refresh-vault-token',
      fn: async () => {
        this.env.logger.info('Renewing Vault token');
        const vaultApi = this.vaultApi ?? new VaultClient(this.env);
        await vaultApi.renewToken?.();
      },
    });
    return this;
  }

  private getConfigSchedule(): SchedulerServiceTaskScheduleDefinition {
    const schedule = this.env.config.getOptional<
      SchedulerServiceTaskScheduleDefinitionConfig | boolean
    >('vault.schedule');

    const scheduleCfg =
      schedule !== undefined && schedule !== false
        ? {
            frequency: { hours: 1 },
            timeout: { hours: 1 },
          }
        : readSchedulerServiceTaskScheduleDefinitionFromConfig(
            this.env.config.getConfig('vault.schedule'),
          );

    return scheduleCfg;
  }

  /**
   * Builds the backend routes for Vault.
   *
   * @param vaultApi - The Vault client used to list the secrets.
   * @returns The generated backend router
   */
  private buildRouter(vaultApi: VaultApi): express.Router {
    const router = Router();
    router.use(express.json());

    router.get('/health', (_, res) => {
      res.json({ status: 'ok' });
    });

    router.get('/v1/secrets/:path', async (req, res) => {
      const { path } = req.params;
      const { engine } = req.query;

      if (typeof path !== 'string') {
        throw new InputError(`Invalid path: ${path}`);
      }
      if (engine && typeof engine !== 'string') {
        throw new InputError(`Invalid engine: ${engine}`);
      }

      const secrets = await vaultApi.listSecrets(path, {
        secretEngine: engine,
      });
      res.json({ items: secrets });
    });

    router.use(MiddlewareFactory.create(this.env).error());
    return router;
  }
}