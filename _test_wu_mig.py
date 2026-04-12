import sqlite3, psycopg2
from migrate_sqlite_to_pg import get_sqlite_columns, get_pg_columns, convert_value

try:
    sq_conn = sqlite3.connect('database.db')
    pg_conn = psycopg2.connect('host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234')

    table = 'work_units'
    cols = get_sqlite_columns(sq_conn.cursor(), table)
    pg_cols = get_pg_columns(pg_conn.cursor(), table)

    COLUMN_MAPPINGS = {
        'work_units': {'assigned_user_id': 'locked_by'}
    }
    table_mappings = COLUMN_MAPPINGS.get(table, {})

    pg_cols_ci = {c.lower(): c for c in pg_cols}

    insert_cols_sqlite = []
    insert_cols_pg = []

    for sq_c in cols:
        target_c = table_mappings.get(sq_c, sq_c)
        if target_c.lower() in pg_cols_ci:
            insert_cols_sqlite.append(sq_c)
            insert_cols_pg.append(pg_cols_ci[target_c.lower()])

    col_list   = ', '.join(f'"{c}"' for c in insert_cols_pg)
    placeholders = ', '.join(['%s'] * len(insert_cols_pg))
    insert_sql = f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

    sq_cur = sq_conn.cursor()
    sq_cur.execute(f'SELECT { ", ".join(cols) } FROM "{table}" LIMIT 1')
    rows = sq_cur.fetchall()
    
    if rows:
        row = rows[0]
        row_dict = dict(zip(cols, row))
        values = [convert_value(sq_c, row_dict[sq_c], set()) for sq_c in insert_cols_sqlite]

        pg_cur = pg_conn.cursor()
        pg_cur.execute(insert_sql, values)
        print('Sucesso!')
    else:
        print('Nenhum dado')
except Exception as e:
    import traceback
    traceback.print_exc()
