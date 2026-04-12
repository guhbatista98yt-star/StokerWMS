import sqlite3
import os

DB_PATH = "database.db"
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

def fix_barcodes():
    print(f"Updating product barcodes from cache in {DB_PATH}...")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get barcodes from cache
    # cache_orcamentos: IDPRODUTO (erp_code), CODBARRAS, CODBARRAS_CAIXA
    # We need to map IDPRODUTO (erp_code) -> CODBARRAS
    # Note: IDPRODUTO in cache is TEXT. products.erp_code is TEXT.
    
    cursor.execute("SELECT DISTINCT IDPRODUTO, CODBARRAS, CODBARRAS_CAIXA FROM cache_orcamentos WHERE CODBARRAS IS NOT NULL OR CODBARRAS_CAIXA IS NOT NULL")
    rows = cursor.fetchall()
    
    print(f"Found {len(rows)} products in cache with barcode data.")
    
    updated = 0
    for row in rows:
        erp_code, unit_bc, box_bc = row
        
        # Clean up barcodes (remove empty strings)
        if hasattr(unit_bc, 'strip') and not unit_bc.strip(): unit_bc = None
        if hasattr(box_bc, 'strip') and not box_bc.strip(): box_bc = None
        
        if not unit_bc and not box_bc:
            continue

        try:
            cursor.execute("""
                UPDATE products 
                SET barcode = ?, box_barcode = ?
                WHERE erp_code = ?
            """, (unit_bc, box_bc, erp_code))
            if cursor.rowcount > 0:
                updated += 1
        except Exception as e:
            print(f"Error updating product {erp_code}: {e}")

    conn.commit()
    conn.close()
    print(f"Updated {updated} products.")

if __name__ == "__main__":
    fix_barcodes()
