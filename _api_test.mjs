async function run() {
  const loginRes = await fetch("http://localhost:411/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "1234" }) 
  });

  const json = await loginRes.json();
  console.log("Login HTTP Status:", loginRes.status);
  console.log("Login Res:", json);
  process.exit(0);
}

run();
