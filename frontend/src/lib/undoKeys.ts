export const roomStackKey = (userId: string) => `stagetime.undo.rooms.${userId}`
export const timerStackKey = (userId: string, roomId: string) => `stagetime.undo.timers.${userId}.${roomId}`
