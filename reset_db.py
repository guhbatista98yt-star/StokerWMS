import sqlite3
import sys

DB_PATH = './database.db'

def reset_database():
    """
    Reseta todas as tabelas de dados operacionais de pedidos.
    PRESERVA: todos os usuários, routes, manual_qty_rules.
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        print(f"[RESET] Conectado a {DB_PATH}")
        print("[RESET] Iniciando limpeza...")
        

        # Desabilitar chaves estrangeiras para permitir a exclusão em qualquer ordem
        cursor.execute("PRAGMA foreign_keys = OFF;")
        print("[RESET] PRAGMA foreign_keys = OFF (desabilitado)")
        
        # 1. Tabelas para limpar TOTALMENTE (ordem de exclusão para evitar FK issues)
        # PRESERVADAS: users, routes (configuração), manual_qty_rules (Qtde Manual)
        tables_to_clear = [
            'exceptions',
            'picking_sessions',
            'work_units', 
            'order_items', 
            'orders', 
            'products', 
            'sections',
            'section_groups',
            'cache_orcamentos',
            'cache_vendas_pendentes', 
            'cache_tubos_conexoes',
            'sessions',
            'audit_logs', 
            'companies', 
            'goals', 
            'alerts',
            'order_volumes',
            # 'users',            # PRESERVADO — todos os usuários
            # 'routes',           # PRESERVADO — configuração do supervisor
            # 'manual_qty_rules', # PRESERVADO — Qtde Manuais configuradas
        ]

        
        for table in tables_to_clear:
            try:
                # Verificar se tabela existe antes de deletar
                cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'")
                if cursor.fetchone():
                    cursor.execute(f"DELETE FROM {table}")
                    deleted = cursor.rowcount
                    print(f"  ✓ {table}: {deleted} registros removidos")
                    
                    # Resetar AutoIncrement se aplicável (sqlite_sequence)
                    cursor.execute(f"DELETE FROM sqlite_sequence WHERE name='{table}'")
                else:
                    print(f"  - {table}: Tabela não encontrada (ignorado)")
            except sqlite3.Error as e:
                print(f"  ⚠ {table}: {str(e)}")
        
        # Commit changes
        conn.commit()
        
        # Reabilitar chaves estrangeiras
        cursor.execute("PRAGMA foreign_keys = ON;")
        print("[RESET] PRAGMA foreign_keys = ON (reabilitado)")

        # Validar Usuários
        cursor.execute("SELECT COUNT(*) FROM users")
        user_count = cursor.fetchone()[0]
        
        cursor.execute("SELECT username FROM users")
        remaining_users = [r[0] for r in cursor.fetchall()]

        print(f"\n[RESET] ✓ Reset concluído!")
        print(f"[RESET] Usuários restantes: {user_count} {remaining_users}")
        print(f"[RESET] Execute 'python sync_db2.py' para recarregar dados do ERP.")
        
        conn.close()
        
    except Exception as e:
        print(f"[ERRO] Falha ao resetar banco: {e}")
        sys.exit(1)

if __name__ == "__main__":
    confirm = input("⚠️  ATENÇÃO: Isso vai apagar TODOS os dados operacionais (Pedidos, Produtos, etc.), mas manterá todos os usuários e configurações de rotas/quantidades manuais. Deseja continuar? (s/N): ")
    
    if confirm.lower() in ['s', 'sim', 'yes', 'y']:
        reset_database()
    else:
        print("[RESET] Operação cancelada pelo usuário.")
