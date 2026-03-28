async function test() {
    const fs = require('fs');
    try {
        const { pdf } = await import('pdf-to-img');
        
        const buffer = fs.readFileSync('test.pdf');
        console.log('Read test.pdf, size:', buffer.length);
        
        const counter = await pdf(buffer);
        console.log('pdf() call successful');
        
        let count = 0;
        for await (const page of counter) {
            console.log('Page extracted, size:', page.length);
            fs.writeFileSync(`output_page_${++count}.jpg`, page);
            if (count >= 1) break;
        }
        console.log('Test completed');
    } catch (err) {
        console.error('Test failed:', err);
    }
}

test();
