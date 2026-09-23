import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { buildServer } from './buildServer.js';

// stdio entry point. Zed launches this through bin/server.js.
buildServer(createConnection(ProposedFeatures.all));
