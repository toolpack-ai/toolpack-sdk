import { describe, it, expect, vi } from 'vitest';
import { ParsingContext } from './parsing-context.js';
import { TreeSitterParser } from './tree-sitter-parser.js';

describe('TreeSitterParser Multi-Language', () => {
    const pc = new ParsingContext();
    const tp = new TreeSitterParser(pc);

    it('should parse Python symbols correctly', async () => {
        const content = `
def hello_world():
    print("hello")

class TestClass:
    def method(self):
        a = 10
`;
        const symbols = await tp.getSymbols({ filePath: 'fake.py', content });
        expect(symbols).toBeDefined();
        expect(symbols.length).toBeGreaterThan(0);
        const names = symbols.map(s => s.name);
        expect(names).toContain('hello_world');
        expect(names).toContain('TestClass');
        expect(names).toContain('method');
    }, 15000);

    it('should parse Go symbols correctly', async () => {
        const content = `
package main

import "fmt"

func HelloWorld() {
    fmt.Println("hello")
}

type MyStruct struct {
    Field int
}

func (m *MyStruct) MyMethod() {}

var GlobalVar = "test"
`;
        const symbols = await tp.getSymbols({ filePath: 'fake.go', content });
        expect(symbols).toBeDefined();
        const names = symbols.map(s => s.name);
        expect(names).toContain('HelloWorld');
        expect(names).toContain('MyStruct');
        expect(names).toContain('MyMethod');
        expect(names).toContain('GlobalVar');
    }, 15000);

    it('should parse Rust symbols correctly', async () => {
        const content = `
fn hello_world() {
    println!("hello");
}

struct MyStruct {
    field: i32,
}

trait MyTrait {
    fn trait_method(&self);
}

enum MyEnum {
    Variant1,
}
`;
        const symbols = await tp.getSymbols({ filePath: 'fake.rs', content });
        expect(symbols).toBeDefined();
        const names = symbols.map(s => s.name);
        expect(names).toContain('hello_world');
        expect(names).toContain('MyStruct');
        expect(names).toContain('MyTrait');
        expect(names).toContain('MyEnum');
    }, 15000);

    it('should parse Java symbols correctly', async () => {
        const content = `
package com.example;

public class MyClass {
    private String myField;

    public void myMethod() {
        int localVar = 10;
    }
}

interface MyInterface {
    void interfaceMethod();
}
`;
        const symbols = await tp.getSymbols({ filePath: 'fake.java', content });
        expect(symbols).toBeDefined();
        const names = symbols.map(s => s.name);
        expect(names).toContain('MyClass');
        expect(names).toContain('myMethod');
        expect(names).toContain('MyInterface');
    }, 15000);

    it('should parse C++ symbols correctly', async () => {
        const content = `
#include <iostream>

void hello_world() {
    std::cout << "hello\\n";
}

class MyClass {
public:
    void my_method() {}
};

struct MyStruct {
    int field;
};

int global_var = 10;
`;
        const symbols = await tp.getSymbols({ filePath: 'fake.cpp', content });
        expect(symbols).toBeDefined();
        const names = symbols.map(s => s.name);
        expect(names).toContain('hello_world');
        expect(names).toContain('MyClass');
        expect(names).toContain('MyStruct');
        expect(names).toContain('global_var');
    }, 15000);
});
