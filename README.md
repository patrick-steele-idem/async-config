async-config
=============

This module provides a simple asynchronous API for loading environment-specific config files and configuration data from other sources. This module utilizes the [shortstop](https://github.com/krakenjs/shortstop) module to provide support for resolving values inside the configuration files based on user-provided "protocol handlers".

This module has extensive tests and is documented, stable and production-ready.

# Table of Contents

- [async-config](#async-config)
- [Installation](#installation)
- [Overview](#overview)
- [Example](#example)
- [Load Order](#load-order)
- [Merging Configurations](#merging-configurations)
- [Environment Variables](#environment-variables)
    - [NODE_ENV](#node_env)
    - [NODE_CONFIG](#node_config)
- [Protocol Handlers](#protocol-handlers)
    - [import](#import)
    - [path](#path)
    - [require](#require)
- [Command Line Arguments](#command-line-arguments)
- [App/Server Startup](#appserver-startup)
- [API](#api)
    - [load(path[, options, callback]) : AsyncConfigHandle](#loadpath-options-callback--asyncconfighandle)
    - [AsyncConfigHandle](#asyncconfighandle)
        - [done(callback)](#donecallback)
- [Notes](#notes)
- [TODO](#todo)
- [Maintainers](#maintainers)
- [Contribute](#contribute)
    - [License](#license)

# Installation

```bash
npm install async-config --save
```

# Overview

This module provides a simple API for loading environment-specific configuration files that is more flexible than alternatives. Its design was inspired by [config](https://github.com/lorenwest/node-config) and [confit](https://github.com/krakenjs/confit), but there are important differences. Unlike with the [config](https://github.com/lorenwest/node-config) module, this module does not use the exports of the module to maintain the loaded configuration. In addition, this module allows configuration files placed anywhere on disk to be loaded. Finally, this module provides an asynchronous API that allows configuration data to be loaded from remote sources and it avoids the use of synchronous I/O methods for reading files from disk. Compared to [confit](https://github.com/krakenjs/confit), this module is more flexible in how configuration files are named and located on disk.

# Example

The basic usage is shown below:

Given the following directory structure:

```
.
└── config
    ├── config.json
    ├── config-production.json
    └── config-development.json
```

Each configuration file should contain valid JSON data such as the following:

```json
{
    "foo": "bar",
    "complex": {
        "hello": "world"
    }
}
```

The following JavaScript code can be used to load the JSON configuration files and flatten them into a single configuration object:

```javascript
require('async-config').load('config/config.json', function(err, config) {
    // The config is just a JavaScript object:
    var foo = config.foo; 
    var hello = config.complex.hello;

    // Use the get() method to safely access nested properties:
    var missing = config.get('complex.invalid.hello'); 
});
```

# Load Order

When loading a configuration file, the following is the default order that configuration data is loaded:

1. `path/{name}.json`
2. `path/{name}-{environment}.json`
3. `path/{name}-local.json`
4. `NODE_CONFIG='{...}'` environment variable 
5. `--NODE_CONFIG='{...}'` command-line arguments

For example, given the following input of `"config/config.json"` and a value of `production`, the configuration data will be loaded and merged in the following order:

1. `path/config.json`
2. `path/config-production.json`
3. `path/config-local.json`
4. `NODE_CONFIG` environment variable 
5. `--NODE_CONFIG='{...}'` command-line arguments

The load order can be modified using any of the following approaches:

```javascript
require('async-config').load(
    'config/config.json',
    {
        sources: function(sources) {
            // Add defaults to the beginning:
            sources.unshift('config/custom-detaults.json');

            // Add overrides to the end:
            sources.push('config/custom-overrides.json');

            // You can also push an object instead of a path to a configuration file:
            sources.push({
                foo: 'bar'
            });

            // You can also push a function that will asynchronously load additional config data:
            sources.push(function(callback) {
                callback(null, {hello: 'world'});
            });
        },
        defaults: ['config/more-detaults.json'],
        overrides: ['config/more-overrides.json']
    },
    function(err, config) {
        ...
    });
```

# Merging Configurations

A deep merge of objects is used to merge configuration objects. Properties in configuration objects loaded and merged later will overwrite properties of configuration objects loaded earlier. Only properties of complex objects that are _not_ `Array` instances are merged.

# Environment Variables

## NODE_ENV

By default, the environment name will be based on the `NODE_ENV` environment variable. In addition, short environment names will be normalized such that `prod` becomes `production` and `dev` becomes `development`.

## NODE_CONFIG

This environment variable allows you to override any configuration from the command line or shell environment.  The `NODE_CONFIG` environment variable must be a JSON formatted string.  Any configurations contained in this will override the configurations found and merged from the config files.

Example:

```bash
env NODE_CONFIG='{"foo":"bar"}' node server.js
```

# Protocol Handlers

This module supports using protocols inside configuration files. For example, given the following JSON configuration file:

```json
{
    "outputDir": "path:../build"
}
```

Protocol handlers can be registered as shown in the following sample code:

```javascript
var configDir  = require('path').resolve(__dirname, 'config');

require('async-config').load(
    require('path').join(configDir, 'config.json'),
    {
        protocols: {
            path: function(path) {
                return require('path').resolve(configDir, path);
            }
        }
    },
    function(err, config) {
        ...
    });
```

Since the `path` protocol handler is used, the final value of the `"outputDir"` directory will be resolved to the full system path relative to the directory containing the configuration file. For example:

```json
{
    "outputDir": "/development/my-app/build"
}
```

By default, the following protocol handlers are registered:

## import

Loads another configuration given by a path relative to the current directory. 

For example:

```json
{
    "raptor-optimizer": "import:./raptor-optimizer.json"
}
```

Since the `async-config` module is used to load the imported configuration file, the imported configuration file will also support environment-specific configuration files. For example:

1. `./raptor-optimizer.json`
2. `./raptor-optimizer-production.json`


## path

Resolves a relative path to an absolute path based on the directory containing the configuration file.

## require

Resolves a value to the exports of an installed Node.js module.

For example:

```json
{
    "main": "require:./app-production"
}
```

# Command Line Arguments

By default, this module will merge configuration data from the `--NODE_CONFIG='{...}'` argument, but you can also easily merge in your own parsed command line arguments. For example, this module can be combined with the [raptor-args](https://github.com/raptorjs3/raptor-args) module as shown in the following sample code:

```javascript
var commandLineArgs = require('raptor-args').createParser({
        '--foo -f': 'boolean',
        '--bar -b': 'string'
    })
    .parse();

require('async-config').load(
    'config/config.json',
    {
        overrides: [commandLineArgs]
    },
    function(err, config) {
        // Do something with the loaded config
    });
```

Therefore, if your app is invoked using `node myapp.js --foo -b hello`, then the final configuration would be:

```javascript
{
    "foo": true,
    "bar": "hello",
    ... // Other properties from the config.json files
}
```

# App/Server Startup

It is common practice to load the configuration at startup and to delay listening on an HTTP port until the configuration is fully loaded. After the configuration has been loaded, the rest of the application should be able access the configuration synchronously. To support this pattern it is recommended to create a `config.js` module in your application as shown below:

__config.js:__

```javascript
var loadedConfig = null;

function configureApp(config, callback) {
    // Apply the configuration to the application...
    
    // Make sure to invoke the callback when the application is fully configured
    callback();
}

// Initiate the loading of the config
var configHandle = require('async-config').load(
    'config/config.json',
    {
        finalize: configureApp
    },
    function(err, config) {
        if (err) {
            throw err;
        }
        
        loadedConfig = config;
    });

/**
 * Synchronous API to return the loaded configuration:
 */
exports.get = function() {
    if (!loadedConfig) {
        throw new Error('Configuration has not been fully loaded!');
    }

    return loadedConfig;
}

/**
 * Add a listener to be added for when the configuration is fully loaded.
 * If the configuration has already been fully loaded then the listener
 * will be invoked immediately.
 */
exports.onConfigured = function(callback) {
    configHandle.done(callback);
}
```

If you are building a server app, your `server.js` might look like the following:

```javascript
var express = require('express');
var config = require('./config');

// Asynchronously load environment-specific configuration data before starting the server
config.onConfigured(function(err, config) {
    if (err) {
        throw err;
    }
    
    var app = express();
    var port = config.port;

    // Configure the Express server app...

    app.listen(port, function() {
        console.log('Listening on port', port);
    });
});
```

For a working sample server application that utilizes this module, please see the source code for the [raptor-samples/weather](https://github.com/raptorjs3/raptor-samples/tree/master/weather) app.

# API

## load(path[, options, callback]) : AsyncConfigHandle

The `load()` method is used to initiate the asynchronous loading of a configuration. The following method signatures are supported:

```javascript
load(path) : AsyncConfigHandle
load(path, options) : AsyncConfigHandle
load(path, options, callback) : AsyncConfigHandle
```

The path should be a file system path to a configuration file. If the path does not have an extension then the `.json` file extension is assumed. The input path will be used to build the search path.

The `options` argument supports the following properties:

- __defaults:__ An array of sources that will be prepended to the load order. Each source can be either a `String` file path, an async `Function` or an `Object`.
- __environment:__ The value of the environment variable (defaults to `process.env.NODE_ENV` or `development`).
- __excludes:__ An `Array` of sources to exclude. Possible values are the following:
    - `"command-line"` - ignore the `--NODE_CONFIG` command line argument
    - `"env"` - ignore the `NODE_CONFIG` environment variable
    - `"env-file"` - ignore `path/{name}-{environment}.json`
    - `"local-file"` - ignore `path/{name}-local.json`
- __finalize:__ An asynchronous `Function` with signature `function (config, callback)` that can be used to post-process the final configuration object and possibly return an entirely new configuration object.
- __helpersEnabled:__ If set to `false` then no helpers will be added to the configuration object (currently the `get()` method is the only helper added to the final configuration object). The default value is `true`.
- __overrides:__ An array of sources that will be appended to the load order. Each source can be either a `String` file path, an async `Function` or an `Object`.
- __protocols:__ An object where each name is the protocol name and the value is a resolver `function` (see the [shortstop](https://github.com/krakenjs/shortstop) docs for more details).
- __sources:__ A function that can be used to modify the default load order.

## AsyncConfigHandle

The `AsyncConfigHandle` object returned by a call to the `load()` method supports the following properties:

### done(callback)

Attaches a callback listener that will be invoked when the configuration has been fully loaded. If the configuration has already been fully loaded then the callback is invoked immediately. The signature of the callback function should be the following:

```javascript
function callback(error, config)
```



# Notes

* Loaded config objects are _not_ cached by this module.

# TODO

- Add support for YAML and other configuration file formats?

# Maintainers

* Patrick Steele-Idem ([Github: @patrick-steele-idem](http://github.com/patrick-steele-idem)) ([Twitter: @psteeleidem](http://twitter.com/psteeleidem))

# Contribute

Pull requests, bug reports and feature requests welcome. To run tests:

```bash
npm install
npm test
```

## License

ISC