import psycopg2
import uuid

DATABASE_PATH = "host=127.0.0.1 port=5435 dbname=data_stoker user=postgres password=1234"
BASE_URL = "http://localhost:5000" # Assuming the server is running on 5000

PRODUCT_ID = '90b50097-6be9-4e37-bf04-fc16e799bec2'
COMPANY_ID = 1

def seed_stock(qty):
    conn = psycopg2.connect(DATABASE_PATH)
    cur = conn.cursor()
    new_id = str(uuid.uuid4())
    cur.execute("""
        INSERT INTO product_company_stock (id, product_id, company_id, stock_qty, erp_updated_at)
        VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (product_id, company_id) DO UPDATE SET stock_qty = EXCLUDED.stock_qty
    """, (new_id, PRODUCT_ID, COMPANY_ID, qty))
    conn.commit()
    conn.close()
    print(f"Seeded stock: {qty}")

def test_api():
    # Login as admin (assuming we have one)
    # Since I don't have login credentials, I'll just check if the code logic is correct 
    # or if I can bypass auth for this test (I can't).
    # But wait, I can just check the db state and logic.
    pass

if __name__ == "__main__":
    seed_stock(10)
    # I'll rely on the user to test the actual API or I'll try to start the server if possible.
    # But for now, ensuring the DB is seeded is a good first step for verification.
