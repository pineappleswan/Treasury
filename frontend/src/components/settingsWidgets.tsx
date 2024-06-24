import { createSignal, For, onCleanup } from "solid-js";
import RightAngleArrow from "../assets/icons/svg/right-angle-arrow.svg?component-solid";
import AlertTriangle from "../assets/icons/svg/alert-triangle.svg?component-solid";

/* Spacing

This component is simply a div with a specified height that serves to separate widgets on the screen.

*/

type SpacingProps = {
  height: number;
}

function Spacing(props: SpacingProps) {
  return (
    <div
      class={`flex shrink-0 w-full`}
      style={`height: ${props.height}px;`}
    ></div>
  );
}

/* Separator line

A one pixel thick horizontal line that acts to visually separate parts of the settings menu.

*/

function SeparatorLine() {
  return (
    <div class="w-full h-[1px] mx-4 mt-1 bg-zinc-300"></div>
  );
}

/* Section

A collapsible container that encapsulates one or more widgets

*/

type SectionProps = {
  title: string;
  hierarchyId: number; // Integer between 0 and 4 inclusive. Higher numbers mean a smaller text font
  defaultCollapsed?: boolean; // True if the section should be collapsed by default
  children?: any;
}

function Section(props: SectionProps) {
  const [ isOpen, setOpen ] = createSignal(true);
  const { title, hierarchyId, defaultCollapsed, children } = props;
  let textSizeClass = "";

  if (defaultCollapsed) {
    setOpen(false);
  }

  // Determine text size
  switch (hierarchyId) {
    case 0: textSizeClass = "text-xl"; break;
    case 1: textSizeClass = "text-lg"; break;
    case 2: textSizeClass = "text-md"; break;
    case 3: textSizeClass = "text-sm"; break;
    case 4: textSizeClass = "text-xs"; break;
    default: console.error(`Invalid hierarchy id for section! Value: ${hierarchyId}`);
  }

  const switchOpenState = () => {
    setOpen(!isOpen());
  };

  return (
    <div>
      <div
        class="
          flex flex-row items-center w-full ml-3 rounded-lg 
          hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
        "
        onClick={switchOpenState}
      >
        <span class={`pl-2 grow font-SpaceGrotesk ${textSizeClass} font-medium text-zinc-900 select-none`}>{title}</span>
        <RightAngleArrow class={`w-7 h-7 rounded-lg ${isOpen() ? "rotate-180" : "rotate-90"}`} />
      </div>
      <SeparatorLine />
      <div
        class={`
        ${!isOpen() && "hidden"}
        `}
      >
        <Spacing height={8} />
        {children}
        <Spacing height={12} />
      </div>
      <Spacing height={12} />
    </div>
  );
}

/* Subtitle

A simple title

*/

type SubtitleProps = {
  text: string;
}

function Subtitle(props: SubtitleProps) {
  const { text } = props;

  return (
    <span class="py-0.5 ml-5 font-SpaceGrotesk text-sm font-medium text-zinc-900 mt-2">{text}</span>
  );
}

/* File selector

TODO

*/

function FileSelector(props: any) {
  return (
    <div class="flex w-40 h-6 bg-zinc-100 border-[1px] border-zinc-300 rounded-md ml-5 mt-2">
      
    </div>
  );
}

/* Checkbox

TODO

*/

type CheckboxProps = {
  name: string;
  options: string[];
}

function Checkbox(props: CheckboxProps) {
  return (
    <div class="flex flex-row">
      <Subtitle text={props.name} />
    </div>
  );
}

/* Multi radio buttons option

A widget with many radio buttons where only one option can be selected

*/

type MultiRadioButtonProps = {
  name: string;
  options: string[];
  defaultOption: string;
  optionalColumnWidth?: number; // In pixels
  onSetCallback: (option: string) => void;
}

function MultiRadioButtonOption(props: MultiRadioButtonProps) {
  const { name, options, defaultOption, onSetCallback, optionalColumnWidth } = props;

  // Ensure default option is valid
  if (!options.includes(defaultOption)) {
    console.error("defaultOption is invalid!");
    return;
  }

  const [ selectedOption, setSelectedOption ] = createSignal(props.defaultOption);

  return (
    <div class="flex flex-col">
      <Subtitle text={name} />
      <div class="flex flex-col ml-8">
        <For each={options}>
          {(option) => (
            <div class="flex flex-row items-center h-7" style={`width: ${optionalColumnWidth ? optionalColumnWidth : 256}px;`}>
              <div
                class={`
                  flex items-center justify-center w-[17px] h-[17px] border-[2px] rounded-full
                  hover:cursor-pointer hover:bg-zinc-200 active:bg-blue-200
                  ${selectedOption() == option ? "border-teal-500" : "border-zinc-900"}
                `}
                onClick={() => {
                  if (selectedOption() == option)
                    return;
                  
                  setSelectedOption(option);
                  onSetCallback(option);
                }}
              >	
                <div
                  class={`w-[9px] h-[9px] bg-teal-500 rounded-full ${selectedOption() != option && "hidden"}`}
                >
                  
                </div>
              </div>
              <span
                class="font-SpaceGrotesk font-normal text-zinc-900 ml-2 grow"
                style={`font-size: 0.825rem; line-height: 1rem;`}
              >{option}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/* Drop down selector

A basic drop down selector where many options can be provided. The user can select any option
and optionally search for options by typing keywords. Additionally, each option can have tags 
associated with it to assist with searching.

*/

type DropdownSelectorOnSetCallback = (setting: string) => void;

type DropdownSelectorProps = {
  options: string[];
  optionsTags?: Map<string, string[]>; // Allows the user to search for some options even when it doesn't match the option's text.
  defaultOption: string;
  widthInPixels: number;
  onSetCallback: DropdownSelectorOnSetCallback;
}

function DropdownSelector(props: DropdownSelectorProps) {
  const { options, optionsTags, defaultOption, widthInPixels, onSetCallback } = props;

  // Config
  const dropdownElementHeight = 24;
  const maxDropdownElementsVisible = 8;

  // Find default option's index in the options
  const defaultIndex = options.indexOf(defaultOption);

  if (defaultIndex < 0) {
    console.error("Default option was not found in the list of options in the dropdown selector component!");
    return;
  }

  // Variables
  const [ visibleOptions, setVisibleOptions ] = createSignal<string[]>([]);
  const [ selectedOption, setSelectedOption ] = createSignal(options[defaultIndex]);
  const [ dropdownVisible, setDropdownVisible ] = createSignal(false);
  const [ editable, setEditable ] = createSignal(false);
  const [ searchText, setSearchText ] = createSignal("");
  const [ menuHeight, setMenuHeight ] = createSignal(0);
  const [ showOutline, setShowOutline ] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let parentDivRef: HTMLDivElement | undefined;

  const refreshVisibleOptions = (includeSelectedOption: boolean) => {
    const newOptions: string[] = [];
    const loweredSearchText = searchText().toLowerCase();

    options.forEach(option => {
      if (!includeSelectedOption && option == selectedOption())
        return;

      // Check tags
      let canInclude = false;

      if (optionsTags) {
        const tags = optionsTags.get(option);

        if (tags) {
          const found = tags.some(tag => tag.toLowerCase().includes(loweredSearchText));

          if (found) {
            canInclude = true;
          }
        }
      }

      // Check if name is searchable
      if (!canInclude) {
        if (loweredSearchText.length == 0 || option.toLowerCase().includes(loweredSearchText)) {
          canInclude = true;
        }
      }

      if (canInclude)
        newOptions.push(option);
    });

    setVisibleOptions(newOptions);
      
    // Calculate menu height
    const height = dropdownElementHeight * Math.min(maxDropdownElementsVisible, newOptions.length + 1) + 1;
    setMenuHeight(height);
  }

  const onDropdownOpen = () => {
    //setDropdownVisible(true);
    setDropdownVisible(true);
    setSearchText("");
    refreshVisibleOptions(false);
    setShowOutline(true);
  }

  const onEditFocus = () => {
    setEditable(true);
    setDropdownVisible(true);
    inputRef?.focus();
    refreshVisibleOptions(true);
  }

  const onEditFocusLost = () => {
    setEditable(false);
    setDropdownVisible(false);
    setSearchText("");
    setShowOutline(false);
  }

  const onEditKeyDown = (event: KeyboardEvent) => {
    // If user presses enter on the search bar and there is exactly one option, then it will be automatically set to it.
    if (event.key == "Enter" && visibleOptions().length == 1) {
      const option = visibleOptions()[0];

      // Set option
      setSelectedOption(option);
      onSetCallback(option);

      // Reset
      setEditable(false);
      setDropdownVisible(false);
      setSearchText("");
    }
  }

  const onSearchInputUpdate = (event: InputEvent) => {
    // @ts-ignore
    const text = event.target.value;
    setSearchText(text);
    refreshVisibleOptions(true);
  }

  // Handle global click event
  const handleDocumentMouseDown = (event: MouseEvent) => {
    if (parentDivRef === undefined) {
      console.error("parentDivRef is undefined!");
      return;
    }

    const clickX = event.clientX;
    const clickY = event.clientY;
    const bounds = parentDivRef.getBoundingClientRect();

    if (clickX < bounds.left || clickX > bounds.right || clickY < bounds.top || clickY > bounds.bottom) {
      setDropdownVisible(false);
      setEditable(false);
      setSearchText("");
      setShowOutline(false);
    }
  }

  document.addEventListener("mousedown", handleDocumentMouseDown);

  onCleanup(() => {
    document.removeEventListener("mousedown", handleDocumentMouseDown);
  });
  
  // First refresh
  refreshVisibleOptions(false);

  return (
    <div
      ref={parentDivRef}
      class={`
        relative flex flex-col bg-white border-[1px] border-zinc-300 rounded-md ml-5 mt-2
        ${showOutline() && "outline-2 outline-blue-600 outline outline-offset-1"}
      `}
      style={`
        width: ${widthInPixels}px;
        height: ${dropdownVisible() ? menuHeight() : dropdownElementHeight}px;
        ${dropdownVisible() && `margin-bottom: -${menuHeight() - dropdownElementHeight}px; z-index: 10;`}
      `}
    >
      <div
        class={`
          flex flex-row shrink-0 content-center w-full
          ${dropdownVisible() ? "border-b-[1px] border-zinc-300 rounded-tl-md rounded-tr-md" : "rounded-md"}
        `}
        style={`height: ${dropdownElementHeight - 1}px;`}
      >
        {editable() ? (
          <input
            ref={inputRef}
            type="text"
            class="
              flex items-center w-full h-full pl-1.5 bg-transparent pb-[1px] rounded-md
              font-SpaceGrotesk text-sm font-normal overflow-clip text-ellipsis
              select-none outline-none
            "
            onBlur={onEditFocusLost}
            onInput={onSearchInputUpdate}
            onKeyDown={onEditKeyDown}
            onFocus={() => setShowOutline(true)}
          >
            {selectedOption()}
          </input>
        ) : (
          <span
            class="
              flex w-full h-full font-SpaceGrotesk text-sm font-normal pl-1.5 overflow-clip text-ellipsis select-none
              rounded-l-md
              hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
            "
            onClick={onEditFocus}
          >
            {selectedOption()}
          </span>
        )}
        <div
          class={`
            flex shrink-0 items-center justify-center aspect-[1.1]
            border-l-[1px] border-zinc-300 rounded-r-sm
            hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
          `}
          style={`height: ${dropdownElementHeight - 2}px;`}
          onClick={onDropdownOpen}
        >
          <RightAngleArrow class="w-5 h-5 rotate-180" />
        </div>
      </div>
      <div
        class="flex flex-col overflow-y-auto w-full"
        style={`height: ${menuHeight()}px; scrollbar-width: thin;`}
      >
        {dropdownVisible() && (
          <For each={visibleOptions()}>
            {(option) => (
              <div
                class="
                  flex items-center w-full shrink-0 font-SpaceGrotesk text-sm pl-1.5 select-none align-self-center
                  overflow-clip text-ellipsis whitespace-nowrap
                  hover:bg-zinc-200 hover:cursor-pointer active:bg-zinc-300
                "
                style={`height: ${dropdownElementHeight}px;`}
                onMouseDown={() => {
                  setDropdownVisible(false);
                  setSelectedOption(option);
                  onSetCallback(option);
                }}
              >
                {option}
              </div>
            )}
          </For>
        )}
      </div>
    </div>
  );
}

/* Warning text

A text element with an alert symbol

*/

type WarningTextProps = {
  text: string;
}

function WarningText(props: WarningTextProps) {
  const { text } = props;
  
  return (
    <div class="flex flex-row w-full ml-5">
      <AlertTriangle class="w-5 h-5 text-yellow-500" />
      <span class="font-SpaceGrotesk text-yellow-500 text-sm ml-2">{text}</span>
    </div>
  );
}

/* Alert text

Same as warning text but colored red

*/

type AlertTextProps = {
  text: string;
}

function AlertText(props: AlertTextProps) {
  const { text } = props;
  
  return (
    <div class="flex flex-row w-full ml-5">
      <AlertTriangle class="w-5 h-5 text-red-500" />
      <span class="font-SpaceGrotesk text-red-500 text-sm ml-2">{text}</span>
    </div>
  );
}

/* Input text box

A simple text box with an optional validity check callback

*/

type InputTextboxProps = {
  name: string;
  namePixelWidth: number;
  defaultValue: string;
  onSetCallback: (value: string) => void;

  // Return false if input should be ignored and the text box be reset to the previous value.
  // Return true if input is considered valid
  // Return a string to modify the input value
  isValidCallback?: (value: string) => string | boolean;
}

function InputTextbox(props: InputTextboxProps) {
  const { name, namePixelWidth, defaultValue, onSetCallback, isValidCallback } = props;
  const [ currentText, setCurrentText ] = createSignal(defaultValue);
  let inputElement: HTMLInputElement | undefined;

  const handleOnChange = (event: Event) => {
    // @ts-ignore
    const newValue = event.target.value;

    // Check if new value is valid if applicable
    if (isValidCallback) {
      if (!isValidCallback(newValue)) {
        inputElement!.value = currentText();
        return;
      }
    }

    setCurrentText(newValue);
    onSetCallback(newValue);
  };

  return (
    <div class="flex flex-row items-center w-full h-6">
      <span
        class="font-SpaceGrotesk text-sm font-normal text-zinc-900 ml-10"
        style={`width: ${namePixelWidth}px`}
      >{name}</span>
      <input
        ref={inputElement}
        type="text"
        class="
          flex grow border-[1px] border-zinc-300 h-full ml-5 rounded-md pl-1
          font-SpaceGrotesk text-sm
        "
        onChange={handleOnChange}
        value={currentText()}
      />
    </div>
  );
}

/* Spoiler text

A text element that is censored with a black bar by default but when clicked, will reveal the text.

*/

type SpoilerTextProps = {
  name: string;
  text: string;
  namePixelWidth: number;

  // When provided, a function will be added to the array where when called, will hide the spoiler text again
  optionalHideFunctionArray?: Function[];
}

function SpoilerText(props: SpoilerTextProps) {
  const { optionalHideFunctionArray } = props;
  const [ visible, setVisible ] = createSignal(false);

  if (optionalHideFunctionArray) {
    optionalHideFunctionArray.push(() => {
      setVisible(false);
    });
  }

  return (
    <div class="flex flex-row items-center w-full h-6">
      <span
        class="font-SpaceGrotesk text-sm font-normal text-zinc-900 ml-10"
        style={`width: ${props.namePixelWidth}px`}
      >{props.name}</span>
      <div
        class={`
          flex items-center justify-center ml-5 rounded-md px-1
          ${visible() ? 
            "bg-zinc-300" :
            "bg-zinc-700 hover:cursor-pointer hover:bg-zinc-800"
          }
        `}
        onClick={() => setVisible(true)}
      >
        <span class={`font-IBMPlexMono text-sm font-medium ${visible() ? "text-zinc-900" : "text-transparent select-none"}`}>{props.text}</span>
      </div>
    </div>
  );
}

export type {
  SpacingProps,
  SectionProps,
  SubtitleProps,
  CheckboxProps,
  MultiRadioButtonProps,
  DropdownSelectorProps,
  WarningTextProps,
  AlertTextProps,
  InputTextboxProps,
  SpoilerTextProps,
  DropdownSelectorOnSetCallback
}

export {
  Spacing,
  SeparatorLine,
  Section,
  Subtitle,
  FileSelector,
  Checkbox,
  MultiRadioButtonOption,
  DropdownSelector,
  WarningText,
  AlertText,
  InputTextbox,
  SpoilerText
}
