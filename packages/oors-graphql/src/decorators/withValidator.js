import { UserInputError } from 'apollo-server';
import { validate, formatError } from 'easevalidation';

export default validatorOrFactory => {
  const { stack } = new Error();

  return resolver => (_, startArgs, ctx, info) => {
    let validator = validatorOrFactory;
    let args = startArgs;

    // eslint-disable-next-line no-underscore-dangle
    if (!validatorOrFactory.__validation__) {
      // if it's not a validator, it must be a factory function
      validator = validatorOrFactory(_, args, ctx, info);
    }

    try {
      args = validate(validator)(startArgs);
    } catch (error) {
      throw new UserInputError('Failed validation!', {
        invalidArgs: Object.keys(error.error),
        error: formatError(error),
        stack,
      });
    }

    return resolver(_, args, ctx, info);
  };
};
