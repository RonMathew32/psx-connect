'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('fix_messages', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.BIGINT
      },
      symbol: {
        type: Sequelize.STRING
      },
      channel_no: {
        type: Sequelize.STRING
      },
      message: {
        type: Sequelize.TEXT('long')
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      last_seen_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      deleted_at: {
        type: Sequelize.DATE
      }
    });
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('fix_messages');
  }
}; 