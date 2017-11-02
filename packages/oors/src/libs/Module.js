/* eslint-disable no-underscore-dangle */
import Ajv from 'ajv';
import ajvKeywords from 'ajv-keywords';
import getPath from 'lodash/get';
import camelCase from 'lodash/camelCase';
import ValidationError from '../errors/ValidationError';

class Module {
  constructor(config = {}) {
    this.name = config.name || this.name || camelCase(this.constructor.name);

    this.filePath = new Error().stack
      .toString()
      .split(/\r\n|\n/)[2]
      .match(/\((.*.js)/)[1];

    this.hooks = {};

    this.ajv = new Ajv({
      allErrors: true,
      // verbose: true,
      async: 'es7',
      coerceTypes: 'array',
      useDefaults: true,
    });

    ajvKeywords(this.ajv, 'instanceof');

    this.config = this.parseConfig(config);
  }

  createValidator(schema) {
    return this.ajv.compile(schema);
  }

  parseConfig(config) {
    const schema = this.constructor.configSchema;

    if (schema) {
      const validate = this.createValidator({
        ...schema,
        properties: {
          ...schema.properties,
          name: {
            type: 'string',
          },
        },
      });

      if (!validate(config)) {
        throw new ValidationError(validate.errors);
      }
    }

    return config;
  }

  initialize(config, manager) {} // eslint-disable-line
  setup(config, manager) {} // eslint-disable-line

  getConfig(key, defaultValue) {
    return key ? getPath(this.config, key, defaultValue) : this.config;
  }

  get manager() {
    if (!this._manager) {
      throw new Error('You need to connect the module to a manager in order to get access to it!');
    }

    return this._manager;
  }

  get app() {
    return this.context.app;
  }

  get context() {
    return this.manager.context;
  }

  export(map) {
    return Object.assign(this.manager.exportMap[this.name], map);
  }

  get(key) {
    if (!Object.keys(this.manager.exportMap[this.name]).includes(key)) {
      throw new Error(`Unable to get exported value for "${key}" key in "${this.name}" module!`);
    }

    return this.manager.exportMap[this.name][key];
  }

  connect(manager) {
    this._manager = manager;
    this.emit('before:initialize');
    this.initialize(this.config, manager);
    this.emit('after:initialize');
  }

  async load() {
    this.emit('before:setup');
    await this.setup(this.config, this.manager);
    this.emit('after:setup');
  }

  dependency(dependency) {
    if (typeof dependency !== 'string') {
      throw new Error(`Unexpected dependency name: ${dependency}!`);
    }
    this.manager.addDependency(this.name, dependency);
    return this.manager.loads[dependency];
  }

  dependencies(dependencies) {
    return Promise.all(dependencies.map(this.dependency.bind(this)));
  }

  on(...args) {
    this.manager.on(...args);
  }

  once(...args) {
    this.manager.once(...args);
  }

  emit(event, ...args) {
    return this.manager.emit(`module:${this.name}:${event}`, ...args.concat([this]));
  }

  createHook(hook, handler, context) {
    return this.manager.run(`${this.name}.${hook}`, handler, context);
  }

  addHook(moduleName, hook, handler = () => {}) {
    this.hooks[`${moduleName}.${hook}`] = handler;
  }
}

export default Module;
