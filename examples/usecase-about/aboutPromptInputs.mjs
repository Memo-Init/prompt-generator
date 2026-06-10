/**
 * Example only — FlowMCP-specific consumer code; the core generator stays
 * generic. These functions know the _grading filesystem layout
 * (<gradingProvidersDir>/<namespace>/<schema>/tools/<tool>/tests/test-N.json)
 * and are therefore NOT part of the package API: nothing in src/ imports
 * them and src/index.mjs does not export them.
 *
 * Both functions fulfill the generator's function-source contract: on
 * success they return exactly { status: true, text } with a non-empty
 * text; every finding (missing folder, empty list, unreadable file)
 * leads to a hard throw WITH path context — never status true with a
 * torso text. The generator wraps such throws as PGEN-030 with function
 * context and preserved cause.
 */

import { readdir, readFile } from 'node:fs/promises'


// Test fixtures inside a tests/ folder follow this exact name pattern.
const TEST_FILE_PATTERN = /^test-(\d+)\.json$/


const assertNonEmptyString = ( { key, value } ) => {
    const isValid = typeof value === 'string' && value.trim() !== ''
    if( isValid === false ) {
        throw new Error( `${key}: must be a non-empty string` )
    }
}


// The _grading layout reserves '_'-prefixed folders for grading metadata
// (e.g. _gradings) and '.'-prefixed entries are OS noise (.DS_Store) —
// both are by-design never schemas or tools. Skipping them is a documented
// layout rule of the consumed structure, not a silent default.
const isContentDirectory = ( { entry } ) => {
    const isReserved = [ '_', '.' ].includes( entry.name.slice( 0, 1 ) )
    const isContent = entry.isDirectory() === true && isReserved === false

    return isContent
}


const readDirectoryNames = async ( { parentPath } ) => {
    let entries
    try {
        entries = await readdir( parentPath, { 'withFileTypes': true } )
    } catch( error ) {
        const reason = error instanceof Error ? error.message : String( error )
        throw new Error( `directory is missing or not readable at '${parentPath}' — ${reason}`, { 'cause': error } )
    }

    const names = entries
        .filter( ( entry ) => {
            const isContent = isContentDirectory( { entry } )
            return isContent
        } )
        .map( ( entry ) => {
            const { name } = entry
            return name
        } )
        .sort()

    return { names }
}


const readTestFileNames = async ( { testsPath } ) => {
    let entries
    try {
        entries = await readdir( testsPath, { 'withFileTypes': true } )
    } catch( error ) {
        const reason = error instanceof Error ? error.message : String( error )
        throw new Error( `tests directory is missing or not readable at '${testsPath}' — ${reason}`, { 'cause': error } )
    }

    const names = entries
        .filter( ( entry ) => {
            const isTestFile = entry.isFile() === true && TEST_FILE_PATTERN.test( entry.name ) === true
            return isTestFile
        } )
        .map( ( entry ) => {
            const { name } = entry
            return name
        } )
        .sort( ( nameA, nameB ) => {
            const numberA = Number( nameA.match( TEST_FILE_PATTERN )[ 1 ] )
            const numberB = Number( nameB.match( TEST_FILE_PATTERN )[ 1 ] )
            return numberA - numberB
        } )

    return { names }
}


// Renders the numbered step plan along the due-diligence chain:
// per schema every tool step (read all tests, write a tool overview),
// then the schema description step; after all schemas one final merge
// step that fills the embedded About template.
const renderStepPlan = ( { namespace, namespacePath, schemas } ) => {
    const toolCount = schemas
        .reduce( ( accumulator, schema ) => {
            const nextCount = accumulator + schema.tools.length
            return nextCount
        }, 0 )
    const testCount = schemas
        .reduce( ( accumulator, schema ) => {
            const schemaTestCount = schema.tools
                .reduce( ( toolAccumulator, tool ) => {
                    const nextToolCount = toolAccumulator + tool.testPaths.length
                    return nextToolCount
                }, 0 )
            return accumulator + schemaTestCount
        }, 0 )

    const lines = []
    const counter = { 'value': 0 }
    const nextStep = () => {
        counter.value = counter.value + 1
        return counter.value
    }

    lines.push( `Step plan for namespace \`${namespace}\` — derived live from \`${namespacePath}\` (${schemas.length} schema(s), ${toolCount} tool(s), ${testCount} test file(s)).` )
    lines.push( '' )

    schemas
        .forEach( ( schema, schemaIndex ) => {
            lines.push( `Schema ${schemaIndex + 1} of ${schemas.length}: \`${schema.name}\`` )
            lines.push( '' )
            schema.tools
                .forEach( ( tool ) => {
                    lines.push( `${nextStep()}. Read the following test files of tool \`${tool.name}\` (field \`response\` holds the real API return):` )
                    tool.testPaths
                        .forEach( ( testPath ) => { lines.push( `   - ${testPath}` ) } )
                    lines.push( '   Then write a tool overview: what comes back and what you can do with it.' )
                } )
            lines.push( `${nextStep()}. From all tool overviews of schema \`${schema.name}\`, write a schema description.` )
            lines.push( '' )
        } )

    lines.push( `${nextStep()}. From all schema descriptions, write the namespace About by filling the embedded template.` )

    return { 'text': lines.join( '\n' ) }
}


// Builds the STEP_PLAN placeholder text for one namespace. Scans the
// _grading layout live (nothing hardcoded) with deterministic ordering:
// schemas and tools alphabetically, tests numerically — two runs over the
// same filesystem state produce the identical text. Embeds NO response
// content, only the test file paths plus instructions: the sub-agent must
// read the files itself.
async function buildStepPlan( { namespace, gradingProvidersDir } ) {
    assertNonEmptyString( { 'key': 'namespace', 'value': namespace } )
    assertNonEmptyString( { 'key': 'gradingProvidersDir', 'value': gradingProvidersDir } )

    const namespacePath = `${gradingProvidersDir}/${namespace}`
    const { names: schemaNames } = await readDirectoryNames( { 'parentPath': namespacePath } )
    if( schemaNames.length === 0 ) {
        throw new Error( `namespace '${namespace}' has no schema directories at '${namespacePath}'` )
    }

    const schemas = await schemaNames
        .reduce( async ( accumulatorPromise, schemaName ) => {
            const accumulator = await accumulatorPromise
            const toolsPath = `${namespacePath}/${schemaName}/tools`
            const { names: toolNames } = await readDirectoryNames( { 'parentPath': toolsPath } )
            if( toolNames.length === 0 ) {
                throw new Error( `schema '${schemaName}' has no tool directories at '${toolsPath}'` )
            }

            const tools = await toolNames
                .reduce( async ( toolAccumulatorPromise, toolName ) => {
                    const toolAccumulator = await toolAccumulatorPromise
                    const testsPath = `${toolsPath}/${toolName}/tests`
                    const { names: testFileNames } = await readTestFileNames( { testsPath } )
                    if( testFileNames.length === 0 ) {
                        throw new Error( `tool '${toolName}' has no test-N.json files at '${testsPath}'` )
                    }

                    const testPaths = testFileNames
                        .map( ( testFileName ) => {
                            const testPath = `${testsPath}/${testFileName}`
                            return testPath
                        } )
                    toolAccumulator.push( { 'name': toolName, testPaths } )

                    return toolAccumulator
                }, Promise.resolve( [] ) )
            accumulator.push( { 'name': schemaName, tools } )

            return accumulator
        }, Promise.resolve( [] ) )

    const { text } = renderStepPlan( { namespace, namespacePath, schemas } )

    return { 'status': true, 'text': text }
}


// Reads the About template and rewrites its fill-in slot delimiters
// losslessly: '{{' -> '[[' and '}}' -> ']]'. The embedded copy therefore
// passes the generator's torso check while the sub-agent still sees every
// slot. The source file is read-only input and never modified.
async function embedAboutTemplate( { aboutTemplatePath } ) {
    assertNonEmptyString( { 'key': 'aboutTemplatePath', 'value': aboutTemplatePath } )

    let content
    try {
        content = await readFile( aboutTemplatePath, 'utf-8' )
    } catch( error ) {
        const reason = error instanceof Error ? error.message : String( error )
        throw new Error( `about template is missing or not readable at '${aboutTemplatePath}' — ${reason}`, { 'cause': error } )
    }

    if( content.trim() === '' ) {
        throw new Error( `about template at '${aboutTemplatePath}' is empty or whitespace-only` )
    }

    const text = content
        .split( '{{' )
        .join( '[[' )
        .split( '}}' )
        .join( ']]' )

    return { 'status': true, 'text': text }
}


export { buildStepPlan, embedAboutTemplate }
