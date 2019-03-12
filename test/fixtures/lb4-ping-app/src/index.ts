// Copyright IBM Corp. 2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

import {PingApplication} from './application';
import {ApplicationConfig} from '@loopback/core';

export {PingApplication};

export async function main(options: ApplicationConfig = {}) {
  const app = new PingApplication(options);
  await app.boot();
  await app.start();

  // const url = app.restServer.url;
  // console.log(`Server is running at ${url}`);
  // console.log(`Try ${url}/ping`);

  return app;
}
