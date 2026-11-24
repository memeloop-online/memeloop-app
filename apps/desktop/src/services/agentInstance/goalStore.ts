import Database from 'better-sqlite3';
import type { AgentGoal, GoalStore } from 'memeloop';

/** UtilityProcess-owned goal state alongside its durable runtime database. */
export class SqliteGoalStore implements GoalStore {
  private readonly database: Database.Database;

  public constructor(databasePath: string, nativeBinding?: string) {
    this.database = new Database(databasePath, { nativeBinding });
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_goals (
        conversationId TEXT PRIMARY KEY,
        executionNodeId TEXT NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        goalJson TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_goals_active
        ON agent_goals(executionNodeId, status, conversationId);
    `);
  }

  public async get(conversationId: string): Promise<AgentGoal | null> {
    const row = this.database.prepare('SELECT goalJson FROM agent_goals WHERE conversationId = ?')
      .get(conversationId) as { goalJson: string } | undefined;
    return row ? JSON.parse(row.goalJson) as AgentGoal : null;
  }

  public async save(goal: AgentGoal, expectedRevision: number | null): Promise<boolean> {
    const values = [goal.executionNodeId, goal.status, goal.revision, JSON.stringify(goal), goal.conversationId];
    const result = expectedRevision === null
      ? this.database.prepare(`
        INSERT INTO agent_goals (executionNodeId, status, revision, goalJson, conversationId)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(conversationId) DO NOTHING
      `).run(...values)
      : this.database.prepare(`
        UPDATE agent_goals SET executionNodeId = ?, status = ?, revision = ?, goalJson = ?
        WHERE conversationId = ? AND revision = ?
      `).run(...values, expectedRevision);
    return result.changes === 1;
  }

  public async listActive(executionNodeId: string, cursor?: string): Promise<{ items: AgentGoal[]; nextCursor?: string }> {
    const rows = this.database.prepare(`
      SELECT conversationId, goalJson FROM agent_goals
      WHERE executionNodeId = ? AND status = 'active' AND conversationId > ?
      ORDER BY conversationId LIMIT 101
    `).all(executionNodeId, cursor ?? '') as Array<{ conversationId: string; goalJson: string }>;
    const page = rows.slice(0, 100);
    return {
      items: page.map(row => JSON.parse(row.goalJson) as AgentGoal),
      ...(rows.length > 100 ? { nextCursor: page[page.length - 1].conversationId } : {}),
    };
  }

  public close(): void {
    this.database.close();
  }
}
