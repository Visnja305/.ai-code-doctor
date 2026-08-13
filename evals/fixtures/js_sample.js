function updatePage(userInput) {
  var data = JSON.parse(userInput);
  document.getElementById("output").innerHTML = data.message;
}

function getTotal(arr) {
  var sum = 0;
  for (var i = 0; i < arr.length; i++) {
    sum = sum + arr[i];
  }
  return sum;
}

function process() {
  let x = 5;
  if (x == "5") {
    console.log("match");
  }
}
