// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-connector-openapi
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

/* eslint-disable camelcase */

require('should');
const loopback = require('loopback');
const pEvent = require('p-event');

describe('OpenAPI connector - security', () => {
  const url = 'http://petstore.swagger.io/v2/pet/';

  describe('Basic auth', function() {
    it('supports basic auth', async () => {
      const req = await getPetByIdRequest({
        basic: {
          username: 'aaabbbccc',
          password: 'header',
        },
      });

      const auth = req.headers.authorization.split(' ');
      req.headers.should.have.property('authorization');
      auth[0].should.equal('Basic');
    });
  });

  describe('apiKey auth', () => {
    it('supports apiKey - in query', async () => {
      const req = await getPetByIdRequest({
        api_key_query: 'abc12',
      });
      req.url.should.equal(url + '1?api_key=abc12');
    });

    it('supports apiKey - in header', async () => {
      const req = await getPetByIdRequest({
        api_key: 'abc12',
      });
      req.url.should.equal(url + '1');
      req.headers.api_key.should.equal('abc12');
    });
  });

  describe('oAuth2', () => {
    it('supports oauth2 - in header', async () => {
      const req = await getPetByIdRequest({
        petstore_auth: {
          token: {
            access_token: 'abc123abc',
          },
        },
      });
      req.headers.should.have.property('authorization');
      req.headers.authorization.should.equal('Bearer abc123abc');
    });

    it('supports oauth2 with token_type', async () => {
      const req = await getPetByIdRequest({
        'x-auth': {
          token: {
            access_token: 'abc123abc',
            token_type: 'JWT',
          },
        },
      });
      req.headers.should.have.property('authorization');
      req.headers.authorization.should.equal('JWT abc123abc');
    });
  });
});

async function getPetByIdRequest(authz) {
  const ds = loopback.createDataSource('swagger', {
    connector: require('../index'),
    spec: 'test/fixtures/2.0/petstore.json',
    authorizations: authz || {},
  });
  await pEvent(ds, 'connected');

  return new Promise(resolve => {
    ds.connector.observe('before execute', (ctx, next) => {
      resolve(ctx.req);
    });

    const PetService = ds.createModel('PetService', {});
    PetService.getPetById({petId: 1});
  });
}
