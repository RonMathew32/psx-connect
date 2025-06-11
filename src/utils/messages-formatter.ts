export const formatMessages = (messages: any[]) => {
    const excludedTags = ['8', '9', '10', '34', '49', '56'];
    return messages.map(msg => {
        const formattedMsg: Record<string, any> = {};
        Object.keys(msg).forEach(key => {
            if (!excludedTags.includes(key)) {
                formattedMsg[key] = msg[key];
            }   
        });
        return formattedMsg;
    });
};