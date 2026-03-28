async function test() {
    try {
        const mod = await import('pdf-to-img');
        console.log('Keys of mod:', Object.keys(mod));
        for (const [key, value] of Object.entries(mod)) {
            console.log(`Key: ${key}, type: ${typeof value}`);
        }
        if (mod.default) {
            console.log('Keys of mod.default:', Object.keys(mod.default));
        }
    } catch (err) {
        console.error('Test failed:', err);
    }
}
test();
