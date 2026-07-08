export const roomStackKey = (userId: string) => `stagetime.undo.rooms.${userId}`
export const timerStackKey = (userId: string, roomId: string) => `stagetime.undo.timers.${userId}.${roomId}`
export const unifiedStackKey = (userId: string, roomId: string) =>
  `stagetime.undo.unified.${userId}.${roomId}`
