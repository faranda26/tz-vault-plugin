/*
 * Copyright 2020 The Backstage Authors
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

import express from 'express';
import { VaultBuilder } from './VaultBuilder';
import {
  LoggerService,
  RootConfigService,
  SchedulerService,
} from '@backstage/backend-plugin-api';

/**
 * Options for the router creation.
 * @public
 */
export interface RouterOptions {
  logger: LoggerService;
  config: RootConfigService;
  scheduler: SchedulerService;
}

/**
 * Creates the routes used for Vault.
 *
 * @param options - The options used for the Vault's router creation
 * @returns The router for Vault
 * @public
 */
export function createRouter(options: RouterOptions): express.Router {
  const { router } = VaultBuilder.createBuilder(options).build();

  return router;
}