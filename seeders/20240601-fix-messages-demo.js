'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('fix_messages', [
      {
        symbol: 'SPL',
        channel_no: '1',
        message: '{"55":"SPL","10201":"1","10202":"4","10203":"4","channelDescription":"TradingSessionStatus/SecurityStatus"}',
        created_at: new Date(),
        last_seen_at: new Date(),
        updated_at: new Date(),
        deleted_at: null
      },
      {
        symbol: 'HBL',
        channel_no: '2',
        message: '{"55":"HBL","10201":"2","10202":"3","10203":"2","channelDescription":"News"}',
        created_at: new Date(),
        last_seen_at: new Date(),
        updated_at: new Date(),
        deleted_at: null
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('fix_messages', null, {});
  }
}; 