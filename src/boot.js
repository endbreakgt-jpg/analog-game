async function isOnlineServer() {
    try {
        const response = await fetch('/api/mode', { cache: 'no-store' });
        if (!response.ok) return false;
        const data = await response.json();
        return data.mode === 'online';
    } catch {
        return false;
    }
}

if (await isOnlineServer()) {
    await import('./online-main.js');
} else {
    await import('./main.js');
}
