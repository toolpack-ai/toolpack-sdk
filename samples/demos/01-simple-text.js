import { Toolpack } from "../../dist/index.js";

async function main() {
    const toolpack = await Toolpack.init({
        provider: "openai",
        defaultMode: "agent"
    });

    const response = await toolpack.generate({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'user', content: 'What is the capital of France?' }
        ]
    });

    console.log(response);
}

main();
