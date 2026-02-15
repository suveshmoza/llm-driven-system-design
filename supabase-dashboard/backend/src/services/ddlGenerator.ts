interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
  unique?: boolean;
  references?: { table: string; column: string };
}

/** Generates a CREATE TABLE DDL statement from structured column definitions. */
export function generateCreateTable(tableName: string, columns: ColumnDef[]): string {
  const sanitizedName = sanitizeIdentifier(tableName);
  const columnDefs = columns.map((col) => {
    const parts = [sanitizeIdentifier(col.name), col.type.toUpperCase()];

    if (col.primaryKey) {
      parts.push('PRIMARY KEY');
    }

    if (!col.nullable && !col.primaryKey) {
      parts.push('NOT NULL');
    }

    if (col.unique) {
      parts.push('UNIQUE');
    }

    if (col.defaultValue !== undefined && col.defaultValue !== '') {
      parts.push(`DEFAULT ${col.defaultValue}`);
    }

    if (col.references) {
      parts.push(`REFERENCES ${sanitizeIdentifier(col.references.table)}(${sanitizeIdentifier(col.references.column)})`);
    }

    return '  ' + parts.join(' ');
  });

  return `CREATE TABLE ${sanitizedName} (\n${columnDefs.join(',\n')}\n);`;
}

/** Generates an ALTER TABLE ADD COLUMN DDL statement. */
export function generateAddColumn(tableName: string, column: ColumnDef): string {
  const parts = [
    `ALTER TABLE ${sanitizeIdentifier(tableName)}`,
    `ADD COLUMN ${sanitizeIdentifier(column.name)} ${column.type.toUpperCase()}`,
  ];

  if (!column.nullable) {
    parts[1] += ' NOT NULL';
  }

  if (column.defaultValue !== undefined && column.defaultValue !== '') {
    parts[1] += ` DEFAULT ${column.defaultValue}`;
  }

  return parts.join(' ') + ';';
}

/** Generates an ALTER TABLE DROP COLUMN DDL statement. */
export function generateDropColumn(tableName: string, columnName: string): string {
  return `ALTER TABLE ${sanitizeIdentifier(tableName)} DROP COLUMN ${sanitizeIdentifier(columnName)};`;
}

/** Generates an ALTER TABLE RENAME COLUMN DDL statement. */
export function generateRenameColumn(tableName: string, oldName: string, newName: string): string {
  return `ALTER TABLE ${sanitizeIdentifier(tableName)} RENAME COLUMN ${sanitizeIdentifier(oldName)} TO ${sanitizeIdentifier(newName)};`;
}

/** Generates a DROP TABLE CASCADE DDL statement. */
export function generateDropTable(tableName: string): string {
  return `DROP TABLE ${sanitizeIdentifier(tableName)} CASCADE;`;
}

/** Generates an ALTER TABLE ALTER COLUMN TYPE DDL statement. */
export function generateAlterColumnType(tableName: string, columnName: string, newType: string): string {
  return `ALTER TABLE ${sanitizeIdentifier(tableName)} ALTER COLUMN ${sanitizeIdentifier(columnName)} TYPE ${newType.toUpperCase()};`;
}

/** Generates an ALTER TABLE SET/DROP NOT NULL DDL statement. */
export function generateSetColumnNullable(tableName: string, columnName: string, nullable: boolean): string {
  const action = nullable ? 'DROP NOT NULL' : 'SET NOT NULL';
  return `ALTER TABLE ${sanitizeIdentifier(tableName)} ALTER COLUMN ${sanitizeIdentifier(columnName)} ${action};`;
}

/** Generates an ALTER TABLE SET/DROP DEFAULT DDL statement. */
export function generateSetColumnDefault(tableName: string, columnName: string, defaultValue: string | null): string {
  if (defaultValue === null) {
    return `ALTER TABLE ${sanitizeIdentifier(tableName)} ALTER COLUMN ${sanitizeIdentifier(columnName)} DROP DEFAULT;`;
  }
  return `ALTER TABLE ${sanitizeIdentifier(tableName)} ALTER COLUMN ${sanitizeIdentifier(columnName)} SET DEFAULT ${defaultValue};`;
}

function sanitizeIdentifier(name: string): string {
  // Only allow alphanumeric and underscore characters
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, '');
  if (cleaned !== name || isReservedWord(cleaned.toUpperCase())) {
    return `"${cleaned}"`;
  }
  return cleaned;
}

const RESERVED_WORDS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
  'TABLE', 'INDEX', 'WHERE', 'FROM', 'JOIN', 'ORDER', 'GROUP', 'BY',
  'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'AND', 'OR', 'NOT',
  'NULL', 'TRUE', 'FALSE', 'AS', 'ON', 'IN', 'IS', 'LIKE', 'BETWEEN',
  'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'USER', 'ROLE',
  'DEFAULT', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT',
  'CHECK', 'UNIQUE', 'CASCADE', 'SET', 'VALUES', 'INTO',
]);

function isReservedWord(word: string): boolean {
  return RESERVED_WORDS.has(word);
}
