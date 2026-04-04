const memory = [];

function addMessage(userId, role, content) {
  memory.push({ userId, role, content });
}

function getMessages(userId) {
  return memory.filter(m => m.userId === userId).slice(-10);
}

function clearMessages(userId) {
  for (let i = memory.length - 1; i >= 0; i--) {
    if (memory[i].userId === userId) memory.splice(i, 1);
  }
}

module.exports = { addMessage, getMessages, clearMessages };
