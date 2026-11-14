// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Patch3QRegistry} from "../Patch3QRegistry.sol";

contract Patch3QRegistryHarness is Patch3QRegistry {
    mapping(address account => bytes pubkey) private testPqKeys;
    mapping(bytes32 pubkeyHash => bool valid) private testPqKeyValidity;
    bool public testPqSignatureValid = true;
    bool public useKeySpecificValidity;

    constructor(address trustedBountyToken) Patch3QRegistry(trustedBountyToken) {}

    function setPqKey(address account, bytes calldata pubkey) external {
        testPqKeys[account] = pubkey;
    }

    function setPqSignatureValid(bool valid) external {
        testPqSignatureValid = valid;
        useKeySpecificValidity = false;
    }

    function setPqKeySignatureValid(bytes calldata pubkey, bool valid) external {
        testPqKeyValidity[keccak256(pubkey)] = valid;
        useKeySpecificValidity = true;
    }

    function _registeredPqKey(address account) internal view override returns (bytes memory pubkey) {
        pubkey = testPqKeys[account];
        require(pubkey.length != 0, "test PQ key missing");
    }

    function _verifyPq(bytes memory pubkey, bytes calldata, bytes memory)
        internal view override returns (bool)
    {
        return useKeySpecificValidity ? testPqKeyValidity[keccak256(pubkey)] : testPqSignatureValid;
    }
}

contract FeeOnTransferToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount - 1;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - 1;
        return true;
    }
}
