const initSqlJs = require('sql.js');
const fs = require('fs');
initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync('memory.db'));
const stmt = db.prepare("SELECT role, count(*) as cnt FROM messages GROUP BY role");
const rows = [];
while (stmt.step()) rows.push(stmt.getAsObject());
stmt.free();
console.log('消息 role 分布:');
rows.forEach(r => console.log('  role:', r.role, 'count:', r.cnt));
});
