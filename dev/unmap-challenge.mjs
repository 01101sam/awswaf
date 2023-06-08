import fs from 'fs';

const mapList = [
    {
        mapKey: "a0_0x4c77",
        origMapFuncName: "a0_0x5bf5",
        finishNumber: 0x1d4f9,
        finishCondVarName: "_0x4a1bd3",
        offset: 0x115
    },
    {
        mapKey: "_0x546f70",
        origMapFuncName: "_0x5ddcae",
        finishNumber: 0x7cb8c,
        finishCondVarName: "_0xe6dc57",
        offset: 0x1cd
    },
    {
        mapKey: "_0x2befd8",
        origMapFuncName: "_0x1b0545",
        finishNumber: 0xc5eb0,
        finishCondVarName: "_0x322fdb",
        offset: 0x74
    },
    {
        mapKey: "_0x476f84",
        origMapFuncName: "_0x389ee1",
        finishNumber: 0x8b323,
        finishCondVarName: "_0xcf71c8",
        offset: 0x14b
    },
    {
        mapKey: "_0x52ffda",
        origMapFuncName: "_0x109d9c",
        finishNumber: 0xeb2ac,
        finishCondVarName: "_0x2458cd",
        offset: 0xa2
    },
    {
        mapKey: "_0x1dbf0f",
        origMapFuncName: "_0x1f256f",
        finishNumber: 0x23a61,
        finishCondVarName: "_0x3beaff",
        offset: 0xf0
    },
    {
        mapKey: "_0x5afb63",
        finishNumber: 0xb31a9,
        finishCondVarName: "_0x894074",
        origMapFuncName: "_0x28da4d",
        offset: 0xc8
    },
    {
        mapKey: "_0x24910b",
        finishNumber: 0x1a7f2,
        finishCondVarName: "_0x563bc6",
        origMapFuncName: "_0xd69630",
        offset: 0x117
    },
    {
        mapKey: "_0x3164fc",
        finishNumber: 0x6331b,
        finishCondVarName: "_0x2aa950",
        origMapFuncName: "_0x860358",
        offset: 0x104
    },
    {
        mapKey: "_0x34750c",
        finishNumber: 0x413d3,
        finishCondVarName: "_0x2de5a9",
        origMapFuncName: "_0x440c87",
        offset: 0x145
    },
    {
        mapKey: "_0x4c86c0",
        finishNumber: 0x4ba82,
        finishCondVarName: "_0x3e3898",
        origMapFuncName: "_0x1e625d",
        offset: 0x11e
    },
];

let content = fs.readFileSync('orig-challenge.js', 'utf-8');

const findConstMap = mapKey => eval("[" + new RegExp(`${mapKey}\\s+=\\s+\\[(.+)\][;,]`, "m").exec(content)[1] + "]"),
    findFinishCond = (finishNumber, finishCondVarName) => {
        // Pattern 1: var finishCondVarName = <condition>;
        // Pattern 2: if (finishNumber === <condition>) break;
        // condition regex is based on different patterns
        const pattern1 = new RegExp(`var\\s+_0x[\\da-f]{3,8}\\s+=\\s+(.+?parseInt\\(${finishCondVarName}.+\\));`),
            pattern2 = new RegExp(`if\\s+?\\(0x${finishNumber.toString(16)}\\s+?===\\s+?(.+)\\)\\s+?break;`);
        for (const pattern of [pattern1, pattern2]) {
            const match = pattern.exec(content);
            if (match) {
                const condition = match[1].replaceAll(finishCondVarName, "getFromMap");
                return new Function(`return getFromMap => ${condition} === ${finishNumber};`)();
            }
        }
    },
    getFuncNameRgx = funcName => new RegExp(`([_xa-f\\d]+)\\s+=\\s+${funcName}[,;]?`);


function getDeObfMap(origMapFuncName, mapKey, finishNumber, finishCondVarName, offset) {
    const constMap = findConstMap(mapKey),
        finishCond = findFinishCond(finishNumber, finishCondVarName),
        getFromMap = shiftedIndex => constMap[shiftedIndex - offset];

    if (!finishCond) throw new Error(`Could not find finish condition for ${mapKey}`);

    // Shift map
    while (true) {
        try {
            if (finishCond(getFromMap)) break;
            else constMap.push(constMap.shift());
        } catch (e) {
            console.error(e);
            constMap.push(constMap.shift());
        }
    }
    return {constMap, getFromMap};
}


function unmap(mapFuncName, getFromMap, mapKey) {
    const funcNameRgx = getFuncNameRgx(mapFuncName);

    // Find the variable that is assigned to _0x24910b
    const varMatch = content.match(new RegExp(funcNameRgx, "g"));
    if (!varMatch || !varMatch.length) throw new Error('Variable not found');

    for (const match of [...(varMatch || []), ...[`${mapFuncName} = ${mapFuncName}`]]) {
        const variableName = funcNameRgx.exec(match)[1].trim();
        if (variableName === undefined) throw new Error(`Could not find variable name in ${JSON.stringify(match)}`);
        const replaceRgx = new RegExp(`(?:${variableName}|\\(${match}\\))\\(([xa-f\\d]+)\\)`, 'g');
        const matchCount = content.match(replaceRgx)?.length || 0;
        // matchCount && console.log(`Unmapping ${variableName}: ${matchCount} matches`);
        if (matchCount)
            // Replace the mapped hex numbers
            content = content.replace(
                replaceRgx,
                (match, hexNumber) => {
                    let result = getFromMap(parseInt(hexNumber));
                    if (result === undefined) throw new Error(`Could not find ${variableName}(${hexNumber}) in map`);
                    result = JSON.stringify(result);
                    console.log(`\t  ${variableName}(${hexNumber}) -> ${result.length < 100 ? result : result.substring(0, 100) + '...'}`);
                    return result;
                }
            );
        if (getFuncNameRgx(variableName).test(content) && variableName !== mapFuncName) {
            console.info(`Found nested ${variableName}, unmapping...`);
            unmap(variableName, getFromMap, mapKey);
        }
    }

    // Remove map variable
    content = content.replace(`\)\(${mapFuncName}`, ")(");

    for (const match of varMatch || []) {
        const variableName = funcNameRgx.exec(match)[1].trim();
        // Remove the variable declaration
        const unmapHint = `/* Unmapped: ${variableName} -> ${mapFuncName} (Map: ${mapKey}) */`;
        content = content
            .replace(new RegExp(`var\\s+${variableName} = ${mapFuncName};`, 'g'), `;`)
            .replace(new RegExp(`var\\s+${variableName} = ${mapFuncName},`, 'g'), `var`)
            .replace(new RegExp(`,\\s+${variableName} = ${mapFuncName};`, 'g'), `;`)
            .replace(new RegExp(`\\s+${variableName} = ${mapFuncName};`, 'g'), `;`)
            .replace(new RegExp(`\\s+${variableName} = ${mapFuncName},`, 'g'), "")
    }
}

function deObfConstMap(mapFuncName, mapKey, finishNumber, finishCondVarName, offset) {
    const {constMap, getFromMap} = getDeObfMap(mapFuncName, mapKey, finishNumber, finishCondVarName, offset);
    // if (mapKey === "_0x1dbf0f") debugger;
    unmap(mapFuncName, getFromMap, mapKey);

    // Remove map
    content = content
        .replace(new RegExp(`var ${mapKey} = .+;`), "")
        .replace(new RegExp(`var ${mapKey} = \[.+\],`), "var")
        .replace(new RegExp(`${mapKey} = \[.+\];`), "")
        .replace(new RegExp(`${mapKey} = \[.+\],`), "")
}

for (const {origMapFuncName, mapKey, finishNumber, finishCondVarName, offset} of mapList)
    deObfConstMap(origMapFuncName, mapKey, finishNumber, finishCondVarName, offset);

// Write the result
fs.writeFileSync('challenge.js', content);
process.exit(0);
