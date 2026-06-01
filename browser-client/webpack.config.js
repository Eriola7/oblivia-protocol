const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = {
    entry: './src/main.js',
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist'),
        clean: true
    },
    plugins: [
        new HtmlWebpackPlugin({ template: './src/index.html' }),
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
        alias: { '@aztec/bb.js': path.resolve(__dirname, 'node_modules/@aztec/bb.js/dest/browser/index.js') },
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
