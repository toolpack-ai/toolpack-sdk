import { Toolpack } from "../../dist/index.js";

async function main() {
    const toolpack = await Toolpack.init({
        provider: "openai",
    });

    // Set mode through setter
    toolpack.setMode("agent");

    const response = await toolpack.generate({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'user', content: 'My name is Harry.' },
            { role: 'assistant', content: 'Nice to meet you, Harry!' },
            { role: 'user', content: 'What is my name?' }
        ]
    });
    console.log('Response:', response.content, '\n');
    console.log(response);
}

main();
