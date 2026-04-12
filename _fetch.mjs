async function run() {
  const loginRes = await fetch("http://localhost:411/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "1234" })
  });
  const cookie = loginRes.headers.get("set-cookie");
  const loginData = await loginRes.json();
  console.log("LOGIN response:");
  console.log({
     ...loginData,
     allowedCompaniesType: typeof loginData.allowedCompanies,
     isArray: Array.isArray(loginData.allowedCompanies)
  });
  
  const meRes = await fetch("http://localhost:411/api/auth/me", {
    headers: { "cookie": cookie || "" }
  });
  const meData = await meRes.json();
  console.log("ME response:");
  console.log({
     ...meData,
     allowedCompaniesType: typeof meData.allowedCompanies,
     isArray: Array.isArray(meData.allowedCompanies)
  });
}
run();
