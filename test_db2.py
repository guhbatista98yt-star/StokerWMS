import sys
import os

sys.path.append(os.getcwd())
from sync_db2 import conectar_db2

try:
    conn_db2 = conectar_db2()
    cursor = conn_db2.cursor()
    cursor.execute("SET CURRENT SCHEMA DBA")
    cursor.execute("SELECT IDPRODUTO, CODBARCX, QTDMULTIPLA FROM PRODUTO_GRADE_CODBARCX FETCH FIRST 10 ROWS ONLY")
    rows = cursor.fetchall()
    for r in rows:
        print(r)
except Exception as e:
    print("Error:", e)
