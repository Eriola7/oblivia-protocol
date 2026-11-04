const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

// Production by default: no eval-based source maps, so the CSP can forbid eval.
const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production';
const relayUrl = process.env.OBLIVIA_RELAY_URL || 'https://oblivia-relay.onrender.com';
const relayOrigin = new URL(relayUrl).origin;

// The signing page holds the passkey secret while signing, so it may run only
// its own bundled script. Styles stay inline-only (they cannot run code).
// Set frame-ancestors and the same policy as an HTTP header on the host too.
const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'" + (mode === 'development' ? " 'unsafe-eval'" : ''),
    "worker-src 'self' blob:",
    "connect-src 'self' " + relayOrigin + (mode === 'development' ? ' ws:' : ''),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
].join('; ');
const cspMeta = { 'Content-Security-Policy': { 'http-equiv': 'Content-Security-Policy', content: csp } };

// Response headers for static hosts that read a _headers file (Netlify,
// Cloudflare Pages). frame-ancestors only works as a header, not in <meta>.
const headersFile = [
    '/*',
    `  Content-Security-Policy: ${csp}; frame-ancestors 'none'`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Strict-Transport-Security: max-age=31536000',
    '',
].join('\n');

class EmitHeadersFile {
    apply(compiler) {
        compiler.hooks.thisCompilation.tap('EmitHeadersFile', compilation => {
            compilation.hooks.processAssets.tap(
                { name: 'EmitHeadersFile', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL },
                () => compilation.emitAsset('_headers', new webpack.sources.RawSource(headersFile)),
            );
        });
    }
}

module.exports = {
    entry: {
        main: './src/main.js',
        multisig: './src/multisig.js',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        clean: true
    },
    plugins: [
        new EmitHeadersFile(),
        new HtmlWebpackPlugin({ template: './src/index.html', filename: 'index.html', chunks: ['main'], meta: cspMeta }),
        new HtmlWebpackPlugin({ template: './src/multisig.html', filename: 'multisig.html', chunks: ['multisig'], meta: cspMeta }),
        new webpack.DefinePlugin({
            __OBLIVIA_RELAY_URL__: JSON.stringify(relayUrl),
            __OBLIVIA_RP_ID__: JSON.stringify(process.env.OBLIVIA_RP_ID || ''),
            __OBLIVIA_PASSKEY_TEST__: JSON.stringify(process.env.OBLIVIA_PASSKEY_TEST === '1'),
        }),
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: 'process/browser',
        }),
    ],
    devServer: {
        static: './dist',
        port: 3000,
        open: true,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp'
        }
    },
    module: {
        rules: [{
            test: /\.js$/,
            exclude: /node_modules/,
            use: { loader: 'babel-loader', options: { presets: ['@babel/preset-env'] } }
        }]
    },
    resolve: {
        conditionNames: ['browser', 'require', 'default'],
        fallback: {
            fs: false,
            net: false,
            tls: false,
            os: false,
            path: false,
            stream: require.resolve('stream-browserify'),
            buffer: require.resolve('buffer/'),
            crypto: require.resolve('crypto-browserify'),
            vm: require.resolve('vm-browserify'),
            url: require.resolve('url/'),
            assert: require.resolve('assert/'),
        }
    },
    experiments: {
        asyncWebAssembly: true,
        topLevelAwait: true
    },
    mode,
    devtool: mode === 'development' ? 'eval-source-map' : false,
    // The bundles include the Groth16 prover; their size is expected.
    performance: { hints: false },
};
