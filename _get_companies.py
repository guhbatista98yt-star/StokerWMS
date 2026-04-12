import pyodbc
import psycopg2
import sys

# Connect to DB2
DB2_CONN_STR = (
    "DSN=CISSODBC;UID=CONSULTA;PWD=qazwsx@123;"
    "MODE=SHARE;CLIENTENCALG=2;PROTOCOL=TCPIP;"
    "TXNISOLATION=1;SERVICENAME=50000;HOSTNAME=192.168.1.200;"
    "DATABASE=CISSERP;"
)

try:
    print("Connecting to DB2...")
    db2_conn = pyodbc.connect(DB2_CONN_STR, timeout=30)
    db2_cursor = db2_conn.cursor()
    db2_cursor.execute("SET CURRENT SCHEMA DBA")
    
    # Try querying companies
    db2_cursor.execute("SELECT IDEMPRESA, NOMEFANTASIA, RAZAOSOCIAL, CNPJ FROM DBA.EMPRESA WHERE IDEMPRESA IN (1, 3)")
    rows = db2_cursor.fetchall()
    
    companies = []
    for row in rows:
        id_emp = str(row[0])
        nome = str(row[1]).strip() if row[1] else str(row[2]).strip()
        cnpj = str(row[3]).strip()
        
        # Format CNPJ if it is raw numbers
        if len(cnpj) == 14 and cnpj.isdigit():
            cnpj = f"{cnpj[:2]}.{cnpj[2:5]}.{cnpj[5:8]}/{cnpj[8:12]}-{cnpj[12:]}"
            
        print(f"Empresa lida: ID={id_emp}, NOME={nome}, CNPJ={cnpj}")
        companies.append((id_emp, nome, cnpj))
        
    db2_conn.close()
    
    # Update PostgreSQL
    print("Updating PostgreSQL...")
    pg_conn = psycopg2.connect('host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234')
    pg_cursor = pg_conn.cursor()
    
    for emp in companies:
        pg_cursor.execute("""
            INSERT INTO companies (id, name, cnpj) 
            VALUES (%s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, cnpj=EXCLUDED.cnpj
        """, emp)
        
    pg_conn.commit()
    pg_conn.close()
    
    print("Sucesso! Empresas atualizadas.")
except Exception as e:
    print(f"Erro: {e}")
