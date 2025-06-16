import { Model, DataTypes } from 'sequelize';
import db from './sequelize';

class FixMessage extends Model {
  public id!: number;
  public symbol!: string;
  public channel_no!: string;
  public message!: string;
  public created_at!: Date;
  public updated_at!: Date;
  public last_seen_at!: Date;
  public deleted_at!: Date | null;
}

FixMessage.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    symbol: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    channel_no: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize: db.sequelize,
    modelName: 'FixMessage',
    tableName: 'fix_messages',
    timestamps: false,
  }
);

export default FixMessage; 