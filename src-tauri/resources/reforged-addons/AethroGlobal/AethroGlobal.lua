local function Trim(text)
    return (text or ""):match("^%s*(.-)%s*$")
end

AethroGlobalDB = AethroGlobalDB or {}

local globalMode = AethroGlobalDB.enabled == true
local originalChatEditSendText = ChatEdit_SendText

local function ApplyGlobalHeader(editBox)
    if not globalMode or not editBox or not editBox:IsShown() then
        return
    end

    local header = editBox.header or ChatFrameEditBoxHeader
    if not header or not header.SetText then
        return
    end

    header:SetText("Global:")

    -- The 3.3.5 client can report the header width before the final colon glyph
    -- has been laid out. Add explicit room for the colon plus the normal gap.
    if editBox.SetTextInsets and header.GetStringWidth then
        editBox:SetTextInsets(header:GetStringWidth() + 22, 5, 0, 0)
    end
end

local function SetGlobalMode(enabled, quiet)
    globalMode = enabled and true or false
    AethroGlobalDB.enabled = globalMode

    if not quiet and DEFAULT_CHAT_FRAME then
        if globalMode then
            DEFAULT_CHAT_FRAME:AddMessage("|cff4CFF00Aethro Global:|r Global chat mode enabled. Type normally to keep chatting in Global.")
        else
            DEFAULT_CHAT_FRAME:AddMessage("|cff4CFF00Aethro Global:|r Global chat mode disabled.")
        end
    end

    if ChatEdit_UpdateHeader and ChatFrameEditBox then
        ChatEdit_UpdateHeader(ChatFrameEditBox)
        ApplyGlobalHeader(ChatFrameEditBox)
    end
end

local function IsChatModeCommand(text)
    local command = text:lower():match("^%s*(/%S+)")
    if not command then
        return false
    end

    return command == "/s"
        or command == "/say"
        or command == "/y"
        or command == "/yell"
        or command == "/p"
        or command == "/party"
        or command == "/g"
        or command == "/guild"
        or command == "/o"
        or command == "/officer"
        or command == "/raid"
        or command == "/rw"
        or command == "/raidwarning"
        or command == "/bg"
        or command == "/battleground"
        or command == "/w"
        or command == "/whisper"
        or command == "/t"
        or command == "/tell"
        or command == "/r"
        or command == "/reply"
        or command:match("^/%d+$") ~= nil
end

SLASH_AETHROGLOBAL1 = "/global"
SLASH_AETHROGLOBAL2 = "/glo"

SlashCmdList.AETHROGLOBAL = function(message)
    message = Trim(message)
    SetGlobalMode(true, message ~= "")

    if message ~= "" then
        SendChatMessage(".global " .. message, "SAY")
    end
end

SLASH_AETHROGLOBALOFF1 = "/globaloff"
SlashCmdList.AETHROGLOBALOFF = function()
    SetGlobalMode(false, false)
end

ChatEdit_SendText = function(editBox, addHistory)
    local text = Trim(editBox and editBox:GetText() or "")

    if globalMode and text ~= "" then
        if IsChatModeCommand(text) then
            SetGlobalMode(false, true)
        elseif text:sub(1, 1) ~= "/" and text:sub(1, 1) ~= "." then
            editBox:SetText(".global " .. text)
        end
    end

    return originalChatEditSendText(editBox, addHistory)
end

if hooksecurefunc then
    hooksecurefunc("ChatEdit_UpdateHeader", function(editBox)
        ApplyGlobalHeader(editBox)
    end)
end

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("PLAYER_LOGIN")
eventFrame:SetScript("OnEvent", function()
    if globalMode then
        DEFAULT_CHAT_FRAME:AddMessage("|cff4CFF00Aethro Global:|r Global chat mode restored. Type /say, /party, /guild, /whisper, or another channel command to leave it.")
    end
end)
