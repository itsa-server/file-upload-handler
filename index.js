/**
 * Accepts and processes filechunks from a client and rebuilds a final file
 * once all chunks have arrived.
 *
 * The filechunks MUST follow specific rules, as specified by http://itsa.io/docs/io/index.html#io-filetransfer
 * Therefore, this module is best used together with the ITSA-framework (http://itsa.io)
 *
 * IMPORTANT NOTE: this module is build for usage with hapijs.
 *
 * <i>Copyright (c) 2015 ITSA - https://github.com/itsa-server/file-upload-handler</i>
 * New BSD License - http://choosealicense.com/licenses/bsd-3-clause/
 *
 * @module file-upload-handler
 * @class Fileuploadhandler
*/

"use strict";

module.exports = {
    // getExpressFns: require("./lib/express-handler"),
    getHapiFns: require("./lib/hapi-handler")
};
