const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: './src/main.js',
    output: {
        filename: 'main.js',
        path: path.resolve(__dirname, 'dist'),
        clean: true
    },
    plugins: [new HtmlWebpackPlugin({ template: './src/index.html' })],
    devServer: { static: './dist', port: 3000, open: true },
    module: {
        rules: [{
            test: /\.js$/,
            exclude: /node_modules/,
            use: { loader: 'babel-loader', options: { presets: ['@babel/preset-env'] } }
        }]
    },
    mode: 'development'
};