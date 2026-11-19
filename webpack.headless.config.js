//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

module.exports = {
    target: 'node',
    mode: 'production',
    entry: {
        eide_cli: './src/cli/eide_cli.ts',
        eide_mcp: './src/mcp/eide_mcp.ts'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'commonjs2'
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader'
                    }
                ]
            }
        ]
    },
    plugins: [
        new webpack.BannerPlugin({
            banner: '#!/usr/bin/env node',
            raw: true,
            entryOnly: true
        })
    ]
};
