const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

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
        new HtmlWebpackPlugin({ template: './src/index.html', filename: 'index.html', chunks: ['main'] }),
        new HtmlWebpackPlugin({ template: './src/multisig.html', filename: 'multisig.html', chunks: ['multisig'] }),
        new webpack.DefinePlugin({
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
    mode: 'development'
};
