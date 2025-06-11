"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMessages = void 0;
const formatMessages = (messages) => {
    const excludedTags = ['8', '9', '10', '34', '49', '56'];
    return messages.map(msg => {
        const formattedMsg = {};
        Object.keys(msg).forEach(key => {
            if (!excludedTags.includes(key)) {
                formattedMsg[key] = msg[key];
            }
        });
        return formattedMsg;
    });
};
exports.formatMessages = formatMessages;
