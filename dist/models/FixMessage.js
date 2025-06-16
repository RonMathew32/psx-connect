"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sequelize_1 = require("sequelize");
const sequelize_2 = __importDefault(require("./sequelize"));
class FixMessage extends sequelize_1.Model {
}
FixMessage.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    symbol: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    channel_no: {
        type: sequelize_1.DataTypes.STRING,
        allowNull: false,
    },
    message: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: false,
    },
    created_at: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
    },
    updated_at: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
    },
    last_seen_at: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
    },
    deleted_at: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: true,
    },
}, {
    sequelize: sequelize_2.default.sequelize,
    modelName: 'FixMessage',
    tableName: 'fix_messages',
    timestamps: false,
});
exports.default = FixMessage;
