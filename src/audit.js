'use strict';
const db = require('./db');

// Registra uma acao auditavel. Valores sao serializados em JSON.
async function audit(userId, action, entity, entityId, oldValue, newValue, reason) {
  await db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId ?? null,
    action,
    entity ?? null,
    entityId ?? null,
    oldValue == null ? null : JSON.stringify(oldValue),
    newValue == null ? null : JSON.stringify(newValue),
    reason ?? null
  );
}

module.exports = { audit };
