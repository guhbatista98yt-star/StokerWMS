
filename = 'server/storage.ts'

with open(filename, 'r') as f:
    lines = f.readlines()

open_braces = 0
for i, line in enumerate(lines):
    line_num = i + 1
    for char in line:
        if char == '{':
            open_braces += 1
        elif char == '}':
            open_braces -= 1
    
    if open_braces < 0:
        print(f"Error: Negative brace count at line {line_num}: {line.strip()}")
        break

if open_braces > 0:
    print(f"Error: Unclosed braces at end of file. Count: {open_braces}")
elif open_braces == 0:
    print("Braces are balanced.")
