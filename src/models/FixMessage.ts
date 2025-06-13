import { DataTypes } from 'sequelize';
import sequelize from '../db/index';

const FixMessage = sequelize.define('FixMessage', {
  id: {
    type: DataTypes.BIGINT,
    autoIncrement: true,
    primaryKey: true,
  },
  symbol: DataTypes.STRING,
  channel_no: DataTypes.STRING,
  message: DataTypes.TEXT('long'),
  created_at: DataTypes.DATE,
  updated_at: DataTypes.DATE,
  last_seen_at: DataTypes.DATE,
  deleted_at: DataTypes.DATE,
}, {
  tableName: 'fix_messages',
  timestamps: true,
  paranoid: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  deletedAt: 'deleted_at',
});

export default FixMessage; 