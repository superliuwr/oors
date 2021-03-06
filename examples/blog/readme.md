Getting started

* you need to have node.js installed (node >= 8 is recommended)
* you need to have mongodb running - by default a database named "oors" is going to be used

Installation:

* clone the repository
* navigate to the blog example
* `yarn` or `npm install`
* `yarn run seed` - this will add seed data

Running the project:

* `yarn run dev`

The server will run on port 3000 (that's set as a default in the configuration).

Files and directory structure:

* `emails` - when running the project in development you have the option to save the emails to a
  local directory instead of sending them out through an email server
* `logs` - well... log files
* `uploads` - when uploading files, you can save them to a local dir (using a cloud provider is
  recommended though)
* `src` - the source directory of your code.
  * `modules` - your application split into modules - later on you should move these modules into
    their own npm modules and have them managed into a monorepo
  * `env` - exceptions handling
  * `index.js` - entry point of your application

While this structure can work well for POC-s and small projects, it's recommended that you use a
monorepo on a bigger project, especially when more developers are involved (example coming soon, but
the oors project is structured as a monorepo).

## The Blog module

`index.js` is the entry point of the module (the module file). Here we register the repositories
from the `repositories` directory, and we create the GraphQL Dataloaders.

Right now the repositories are just extending the base Repository class provided by the oors-mongodb
module and define a schema for the data we want to store, but as you progress with specific business
logic code, you can put it here initially (and move it to specialized services objects later on if
it makes sense). Don't put your business logic code inside GraphQL resolvers or route handler!!!

Links to check once you started the server:

* http://localhost:3000/graphiql
* http://localhost:3000/playground
* http://localhost:3000/voyager
