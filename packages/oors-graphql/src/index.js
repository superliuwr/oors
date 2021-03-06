/* eslint-disable no-empty, import/no-dynamic-require, global-require */
import { validate, validators as v } from 'easevalidation';
import { graphql } from 'graphql';
import glob from 'glob';
import path from 'path';
import fse from 'fs-extra';
import get from 'lodash/get';
import set from 'lodash/set';
import has from 'lodash/has';
import pick from 'lodash/pick';
import isPlainObject from 'lodash/isPlainObject';
import invariant from 'invariant';
import identity from 'lodash/identity';
import { Module } from 'oors';
import { PubSub } from 'graphql-subscriptions';
import merge from 'lodash/merge';
import {
  makeExecutableSchema,
  makeRemoteExecutableSchema,
  mergeSchemas,
  addResolveFunctionsToSchema,
  addSchemaLevelResolveFunction,
  attachDirectiveResolvers,
} from 'graphql-tools';
import { express as voyagerMiddleware } from 'graphql-voyager/middleware';
import { importSchema } from 'graphql-import';
import { Binding } from 'graphql-binding';
import ConstraintDirective from 'graphql-constraint-directive';
import depthLimit from 'graphql-depth-limit';
import { isMiddlewarePivot } from 'oors-express/build/validators';
import mainResolvers from './graphql/resolvers';
import modulesResolvers from './graphql/modulesResolvers';
import LoadersMap from './libs/LoadersMap';
import * as decorators from './decorators';
import Server from './libs/Server';

const asyncGlob = (...args) =>
  new Promise((resolve, reject) => {
    glob(...args, (err, files) => {
      if (err) {
        reject(err);
      } else {
        resolve(files);
      }
    });
  });

class Gql extends Module {
  static validateConfig = validate(
    v.isSchema({
      voyager: [
        v.isDefault({}),
        v.isSchema({
          enabled: [v.isDefault(true), v.isBoolean()],
          params: [
            v.isDefault({}),
            v.isSchema({
              endpointURL: [v.isDefault('/graphql'), v.isString()],
            }),
          ],
        }),
      ],
      middlewarePivot: [v.isDefault('isMethod'), isMiddlewarePivot()],
      configureSchema: v.isAny(v.isFunction(), v.isUndefined()),
      exposeModules: [v.isDefault(true), v.isBoolean()],
      serverOptions: [v.isDefault({}), v.isObject()],
      pubsub: v.isAny(v.isObject(), v.isUndefined()),
      depthLimit: [
        v.isDefault({}),
        v.isSchema({
          limit: [v.isDefault(10), v.isInteger()],
          options: v.isAny(
            v.isSchema({
              ignore: [v.isDefault([]), v.isArray()],
            }),
            v.isUndefined(),
          ),
          callback: v.isAny(v.isFunction(), v.isUndefined()),
        }),
      ],
      costAnalysis: [
        v.isDefault({}),
        v.isSchema({
          maximumCost: [v.isDefault(1000), v.isInteger(), v.isPositive()],
        }),
      ],
    }),
  );

  name = 'oors.graphql';

  hooks = {
    'oors.cache.load': ({ createPolicy }) => {
      createPolicy('graphqlResolvers');
    },
  };

  initialize() {
    this.typeDefs = [];
    this.directives = {
      constraint: ConstraintDirective,
    };
    this.resolvers = mainResolvers;
    this.resolverMiddlewares = [];
    this.pubsub = this.getConfig('pubsub', new PubSub());
    this.gqlContext = {
      pubsub: this.pubsub,
      modules: this.manager,
    };
    this.loaders = new LoadersMap();
    this.contextExtenders = [];
    this.formatters = {
      params: [],
      error: [],
      response: [],
    };
  }

  async setup() {
    await this.loadDependencies(['oors.express']);
    await this.runHook(
      'load',
      this.collectFromModule,
      pick(this, [
        'pubsub',
        'addTypeDefs',
        'addDirectives',
        'addTypeDefsByPath',
        'addResolvers',
        'addResolverMiddleware',
        'addLoader',
        'loadFromDir',
      ]),
    );

    Object.assign(this.gqlContext, {
      app: this.deps['oors.express'].app,
    });

    if (this.getConfig('exposeModules')) {
      this.addResolvers(modulesResolvers);
      await this.addTypeDefsByPath(path.resolve(__dirname, './graphql/modulesTypeDefs.graphql'));
    }

    await this.runHook('buildContext', () => {}, {
      context: this.gqlContext,
    });

    this.schema = await this.buildSchema();
    this.server = this.buildServer();

    this.applyMiddlewares(this.server);

    const binding = this.bindSchema(this.schema);

    this.exportProperties([
      'extendContext',
      'schema',
      'server',
      'loaders',
      'addResolverMiddleware',
      'addLoader',
      'addLoaders',
      'addResolvers',
      'importSchema',
      'bindSchema',
      'binding',
      'setupListen',
      'pubsub',
      'formatters',
      'buildContext',
      'execute',
    ]);

    this.export({
      context: this.gqlContext,
      addSchemaResolvers: rootResolveFunction =>
        addSchemaLevelResolveFunction(this.schema, rootResolveFunction),
      addDirectivesResolvers: directivesResolvers =>
        attachDirectiveResolvers(this.schema, directivesResolvers),
    });

    this.on('after:setup', () => {
      Object.assign(this.gqlContext, {
        binding,
      });
    });
  }

  teardown = () => this.server.stop();

  extendContext = extender => {
    invariant(
      typeof extender === 'function' || isPlainObject(extender),
      `Invalid context extender! Needs to be either a function or a an object that will get 
      assigned to the context.`,
    );
    this.contextExtenders.push(extender);
    return this.contextExtenders;
  };

  bindSchema = (schema, options = {}) =>
    new Binding({
      schema,
      ...options,
    });

  addTypeDefs = typeDefs => {
    this.typeDefs.push(typeDefs);
  };

  addDirectives = directives => {
    Object.assign(this.directives, directives);
  };

  addResolvers = resolvers => {
    if (this.schema) {
      addResolveFunctionsToSchema({ schema: this.schema, resolvers });
    } else {
      merge(this.resolvers, resolvers);
    }
  };

  addResolverMiddleware = (matcher, middleware) => {
    this.resolverMiddlewares.push({
      matcher: typeof matcher === 'string' ? new RegExp(`^${matcher}$`) : matcher,
      middleware,
    });

    return this;
  };

  addLoader = (...args) => {
    this.loaders.add(...args);
  };

  addLoaders = (...args) => {
    this.loaders.multiAdd(...args);
  };

  addTypeDefsByPath = async filePath => {
    this.addTypeDefs(await fse.readFile(filePath, 'utf8'));
  };

  importSchema = schemaPath => {
    this.addTypeDefs(importSchema(schemaPath));
  };

  loadFromDir = async dirPath => {
    await Promise.all([
      this.loadTypeDefsFromDir(dirPath),
      this.loadResolversFromDir(dirPath),
      this.loadDirectivesFromDir(dirPath),
    ]);
  };

  loadTypeDefsFromDir = async dirPath => {
    try {
      // try to load /graphql/typeDefs/**/*.graphl
      const typeDefsDirPath = path.join(dirPath, 'typeDefs');
      const stats = await fse.stat(typeDefsDirPath);
      if (stats.isDirectory()) {
        const files = await asyncGlob(path.resolve(typeDefsDirPath, '**/*.graphql'));
        await Promise.all(files.map(file => this.addTypeDefsByPath(file)));
      }
    } catch {
      // try to load /graphql/typeDefs.graphl
      try {
        await this.addTypeDefsByPath(path.join(dirPath, 'typeDefs.graphql'));
      } catch {}
    }
  };

  loadResolversFromDir = async dirPath => {
    try {
      const resolvers = require(`${dirPath}/resolvers`);
      if (resolvers.default) {
        Object.assign(resolvers, resolvers.default);
        delete resolvers.default;
      }
      this.addResolvers(resolvers);
    } catch (err) {
      const resolversPath = await asyncGlob(path.resolve(`${dirPath}/resolvers`, '**/*.js'));
      const resolvers = resolversPath.reduce((acc, resolverPath) => {
        const resolverName = path
          .relative(`${dirPath}/resolvers`, resolverPath)
          .slice(0, -3)
          .split(path.sep)
          .join('.');

        set(acc, resolverName, require(resolverPath).default);

        return acc;
      }, {});
      this.addResolvers(resolvers);
    }
  };

  loadDirectivesFromDir = async dirPath => {
    try {
      const directives = require(`${dirPath}/directives`);
      if (directives.default) {
        Object.assign(directives, directives.default);
        delete directives.default;
      }
      this.addDirectives(directives);
    } catch (err) {}
  };

  collectFromModule = async module => {
    if (!module.getConfig('oors.graphql.autoload', true)) {
      return;
    }

    try {
      if (has(module, 'graphql')) {
        this.addTypeDefs(get(module, 'graphql.typeDefs', ''));
        this.addResolvers(get(module, 'graphql.resolvers', {}));
        if (has(module, 'graphql.typeDefsPath')) {
          await this.addTypeDefsByPath(get(module, 'graphql.typeDefsPath'));
        }
      } else {
        await this.loadFromDir(path.resolve(path.dirname(module.filePath), 'graphql'));
      }
    } catch (err) {}
  };

  buildSchema = async () => {
    const schema = makeExecutableSchema(
      this.getConfig('configureSchema', identity)({
        typeDefs: this.typeDefs,
        resolvers: this.applyResolversMiddlewares(this.resolvers),
        logger: {
          log: err => {
            this.emit('error', err);
          },
        },
        allowUndefinedInResolve: false,
        inheritResolversFromInterfaces: true,
        schemaDirectives: this.directives,
      }),
    );

    const schemas = (await this.runHook('getSchema', () => {}, {
      schema,
      mergeSchemas,
      makeExecutableSchema,
      makeRemoteExecutableSchema,
    })).filter(s => s);

    return schemas.length
      ? mergeSchemas({
          schemas: [schema, ...schemas],
        })
      : schema;
  };

  buildServer = (options = {}) => {
    const config = {
      context: this.buildContext,
      formatError: this.format('error'),
      formatParams: this.format('params'),
      formatResponse: this.format('response'),
      schema: this.schema,
      debug: true,
      tracing: true,
      cacheControl: true,
      subscriptions: true,
      introspection: true,
      mocks: false,
      persistedQueries: true,
      validationRules: [
        depthLimit(
          this.getConfig('depthLimit.limit'),
          this.getConfig('depthLimit.options'),
          this.getConfig('depthLimit.callback'),
        ),
        // costAnalysis(this.getConfig('costAnalysis')),
      ],
      costAnalysisConfig: this.getConfig('costAnalysis'),
      ...this.getConfig('serverOptions'),
      ...options,
    };

    const server = new Server(config);

    if (config.subscriptions) {
      server.installSubscriptionHandlers(this.deps['oors.express'].server);
    }

    return server;
  };

  buildContext = ({ req, connection } = {}) => {
    const context = {
      ...this.gqlContext,
      loaders: this.loaders.build(),
      req,
      connection,
      ...(req
        ? {
            user: req.user,
          }
        : {}),
      ...(connection ? connection.context || {} : {}),
    };

    this.contextExtenders.forEach(extender => extender(context));

    context.execute = (source, options = {}) =>
      this.execute(source, {
        ...options,
        context: () => ({
          ...context,
          ...(options.context || {}),
        }),
      });

    return context;
  };

  applyResolversMiddlewares(resolvers) {
    if (!this.resolverMiddlewares.length) {
      return resolvers;
    }

    return Object.keys(resolvers).reduce(
      (resolversAcc, type) => ({
        ...resolversAcc,
        [type]: Object.keys(resolvers[type]).reduce((typeAcc, field) => {
          let resolver = resolvers[type][field];
          const branch = `${type}.${field}`;
          const middlewares = this.resolverMiddlewares.filter(({ matcher }) =>
            matcher.test(branch),
          );

          if (middlewares.length) {
            resolver = [...middlewares]
              .reverse()
              .reduce((acc, { middleware }) => (...args) => middleware(...args, acc), resolver);
          }

          return {
            ...typeAcc,
            [field]: resolver,
          };
        }, {}),
      }),
      {},
    );
  }

  execute = (source, options = {}) => {
    const { root, context, variables, operation } = {
      root: undefined,
      variables: {},
      operation: undefined,
      ...options,
      context:
        typeof options.context === 'function'
          ? options.context(this.buildContext)
          : {
              ...this.buildContext(),
              ...(options.context || {}),
            },
    };

    return graphql(this.schema, source, root, context, variables, operation);
  };

  applyMiddlewares(server) {
    this.deps['oors.express'].middlewares.insertBefore(
      this.getConfig('middlewarePivot'),
      this.getApolloServerMiddlewares(server),
      this.getVoyagerMiddleware(),
    );
  }

  // eslint-disable-next-line class-methods-use-this
  getApolloServerMiddlewares(server) {
    return {
      id: 'apolloServer',
      apply: ({ app }) => {
        server.applyMiddleware({
          app,
          cors: false,
          bodyParserConfig: false,
          onHealthCheck: req => this.asyncEmit('healthCheck', req),
        });
      },
    };
  }

  getVoyagerMiddleware() {
    return {
      id: 'voyager',
      path: '/voyager',
      factory: ({ endpointURL }) => voyagerMiddleware({ endpointUrl: endpointURL }),
      params: this.getConfig('voyager.params'),
      enabled: this.getConfig('voyager.enabled'),
    };
  }

  format = type => {
    invariant(Array.isArray(this.formatters[type]), `Unknown formatter type - ${type}!`);
    return arg => this.formatters[type].reduce((acc, formatter) => formatter(acc), arg);
  };
}

export { Gql as default, decorators };
export * from './decorators';
export { default as Resolvers } from './libs/Resolvers';
