"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const index_1 = __importDefault(require("../db/index"));
const FixMessage = index_1.default.define('FixMessage', {
    id: {
        type: sequelize_1.DataTypes.BIGINT,
        autoIncrement: true,
        primaryKey: true,
    },
    symbol: sequelize_1.DataTypes.STRING,
    channel_no: sequelize_1.DataTypes.STRING,
    message: sequelize_1.DataTypes.TEXT('long'),
    created_at: sequelize_1.DataTypes.DATE,
    updated_at: sequelize_1.DataTypes.DATE,
    last_seen_at: sequelize_1.DataTypes.DATE,
    deleted_at: sequelize_1.DataTypes.DATE,
}, {
    tableName: 'fix_messages',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
});
exports.default = FixMessage;
