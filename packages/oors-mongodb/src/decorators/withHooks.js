import get from 'lodash/get';

const isFunction = val => typeof val === 'function';

export default (
  hooks = {
    before: {},
    after: {},
    beforeAll: null,
    afterAll: null,
  },
) => repository => {
  [
    'findById',
    'findOne',
    'findMany',
    'createOne',
    'createMany',
    'updateOne',
    'updateMany',
    'replaceOne',
    'deleteOne',
    'deleteMany',
    'save',
    'count',
    'query',
    'aggregate',
  ].forEach(method => {
    const previous = repository[method];
    const hasHooksForMethod =
      isFunction(hooks.beforeAll) ||
      isFunction(hooks.afterAll) ||
      ['before', 'after'].some(
        hookName =>
          Object.keys(hooks[hookName]).includes(method) && isFunction(hooks[hookName][method]),
      );

    if (!hasHooksForMethod) {
      return;
    }

    Object.assign(repository, {
      [method]: async (...args) => {
        if (typeof get(hooks, `before.${method}`) === 'function') {
          await hooks.before[method](...args);
        }

        if (typeof hooks.beforeAll === 'function') {
          await hooks.beforeAll(method, ...args);
        }

        const result = await previous.call(repository, ...args);

        if (typeof hooks.afterAll === 'function') {
          await hooks.afterAll(method, result, ...args);
        }

        if (typeof get(hooks, `after.${method}`) === 'function') {
          await hooks.after[method](result, ...args);
        }

        return result;
      },
    });
  });

  return repository;
};
