
async function testLogin() {
    try {
        const response = await fetch("http://localhost:9005/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "admin", password: "1234" })
        });

        const data = await response.json();
        console.log("Status:", response.status);
        console.log("Response:", data);
    } catch (e) {
        console.error("Fetch Error:", e);
    }
}

testLogin();
